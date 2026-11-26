import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESCRIPTOR_VERSION, classify, describe, describeLlm, entryFromDescriptor, type LlmDescriptor, type ModelDescriptor } from "./catalog-adapter";
import { choicesOf, optionKey, optionKeyFromBody } from "./options";
import { KNOWN_PRICES } from "./known-prices";
import type { ModelEntry } from "./types";

/**
 * Atlas models enabled by the user (picked from the catalog in a node).
 * Stored next to the database, so each install keeps its own selection.
 */

interface StoreFile {
  media: ModelDescriptor[];
  llm: LlmDescriptor[];
  /** Unit prices learned from what Atlas actually billed (model id → USD per unit). */
  observed?: Record<string, { usd: number; at: number }>;
}

function file() {
  const db = path.resolve(/*turbopackIgnore: true*/ process.env.NIKKA_DB_PATH ?? "./data/nikka.db");
  return path.join(path.dirname(db), "models.json");
}

let cache: { mtime: number; path: string; data: Required<StoreFile>; entries: ModelEntry[] } | null = null;

export function readStore(): Required<StoreFile> & { entries: ModelEntry[] } {
  const f = file();
  if (!existsSync(f)) return { media: [], llm: [], observed: {}, entries: [] };
  const mtime = statSync(f).mtimeMs;
  if (!cache || cache.mtime !== mtime || cache.path !== f) {
    const raw = JSON.parse(readFileSync(f, "utf8")) as Partial<StoreFile>;
    const data = { media: raw.media ?? [], llm: raw.llm ?? [], observed: raw.observed ?? {} };
    // A price seen on a real bill replaces the catalog base price, per definition / quality.
    const entries = data.media.map((d) => {
      const usd = data.observed[d.id]?.usd ?? KNOWN_PRICES[d.id];
      const byOption: Record<string, number> = {};
      // Known real prices first, then what this install learned.
      for (const [key, known] of Object.entries(KNOWN_PRICES)) if (key.startsWith(`${d.id}|`)) byOption[key.slice(d.id.length + 1)] = known;
      for (const [key, o] of Object.entries(data.observed)) if (key.startsWith(`${d.id}|`)) byOption[key.slice(d.id.length + 1)] = o.usd;
      const entry = entryFromDescriptor(usd !== undefined ? { ...d, pricing: { ...d.pricing, usd }, priceUnitAssumed: false } : d);
      return { ...entry, pricingByOption: byOption, priceConfirmed: usd !== undefined };
    });
    cache = { mtime, path: f, data, entries };
  }
  return { ...cache.data, entries: cache.entries };
}

/**
 * Learns a model's real unit price (USD per image, or per second of video)
 * from a bill, for the definition / quality that was billed. The model's
 * default definition also sets its base price.
 */
export function recordObservedPrice(modelId: string, unitUsd: number, body: Record<string, unknown> = {}) {
  if (!(unitUsd >= 0) || !Number.isFinite(unitUsd)) return;
  const store = readStore();
  const entry = store.entries.find((e) => e.id === modelId);
  if (!entry) return;
  const usd = Math.round(unitUsd * 100000) / 100000;
  const key = optionKeyFromBody(entry.options, body);
  const isDefault = !key || key === optionKey(entry.options, choicesOf(entry.options).defaults);
  const observed = { ...store.observed };
  if (key) observed[`${modelId}|${key}`] = { usd, at: Date.now() };
  if (isDefault) observed[modelId] = { usd, at: Date.now() };
  if (JSON.stringify(observed) === JSON.stringify(store.observed)) return;
  write({ media: store.media, llm: store.llm, observed });
}

/** The pricing unit of an enabled model. */
export function pricingUnit(modelId: string) {
  return readStore().entries.find((e) => e.id === modelId)?.pricing.unit;
}

function write(data: StoreFile) {
  const f = file();
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(data, null, 2));
  cache = null;
}

/** Enables a catalog model: reads its schema, builds its adapter, stores it. */
export async function enableModel(id: string): Promise<{ media?: ModelDescriptor; llm?: LlmDescriptor }> {
  const { findModel, getModelInputSchema, unitPrice } = await import("@/lib/atlas/catalog");
  const m = await findModel(id);
  if (!m) throw new Error(`Modèle absent du catalogue Atlas : ${id}`);
  const kind = classify(m);
  if (!kind) throw new Error(`${id} : type de modèle non pris en charge par NIKKA`);
  const { media, llm } = readStore();
  if (kind === "llm") {
    const d = describeLlm(m as typeof m & { contextLength?: number });
    write({ media, llm: [...llm.filter((x) => x.id !== id), d], observed: readStore().observed });
    return { llm: d };
  }
  const d = describe(m, await getModelInputSchema(m), unitPrice(m));
  write({ media: [...media.filter((x) => x.id !== id), d], llm, observed: readStore().observed });
  return { media: d };
}

export function disableModel(id: string) {
  const { media, llm } = readStore();
  write({ media: media.filter((x) => x.id !== id), llm: llm.filter((x) => x.id !== id), observed: readStore().observed });
}

/** First run in live mode: the selection proposed to the user (schemas verified). */
export const RECOMMENDED = [
  "deepseek-ai/deepseek-v4-flash",
  // GPT Image 1.5 and FLUX.2 Pro Edit failed upstream at Atlas on 2026-11-26 (not billed).
  "black-forest-labs/flux-3/text-to-image",
  "bytedance/seedream-v5.0-lite/edit",
  "bytedance/seedance-v1-pro-fast/image-to-video",
  "kwaivgi/kling-v2.5-turbo-pro/image-to-video",
  "bytedance/seedance-v1-pro-fast/text-to-video",
];

let seeding: Promise<void> | null = null;
/**
 * First live run: enables the recommended set. Later runs: models described
 * with older rules are rebuilt from their schema (they gain new options such
 * as format and definition); learned prices are kept.
 */
export function ensureRecommended(): Promise<void> {
  const { media, llm } = readStore();
  const outdated = media.filter((d) => (d.v ?? 1) < DESCRIPTOR_VERSION).map((d) => d.id);
  if ((media.length || llm.length) && !outdated.length) return Promise.resolve();
  seeding ??= (async () => {
    const ids = media.length || llm.length ? outdated : RECOMMENDED;
    for (const id of ids) await enableModel(id).catch(() => undefined);
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}
