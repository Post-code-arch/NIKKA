import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { classify, describe, describeLlm, entryFromDescriptor, type LlmDescriptor, type ModelDescriptor } from "./catalog-adapter";
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
    // A price seen on a real bill replaces the catalog base price.
    const priced = data.media.map((d) => {
      const usd = data.observed[d.id]?.usd ?? KNOWN_PRICES[d.id];
      return usd !== undefined ? { ...d, pricing: { ...d.pricing, usd }, priceUnitAssumed: false } : d;
    });
    cache = { mtime, path: f, data, entries: priced.map(entryFromDescriptor) };
  }
  return { ...cache.data, entries: cache.entries };
}

/**
 * Learns a model's real unit price from a bill: the estimate used the
 * current unit price, so real unit = unit × billed / estimated.
 */
export function recordObservedPrice(modelId: string, estimatedUsd: number, billedUsd: number) {
  if (!(estimatedUsd > 0) || !(billedUsd >= 0)) return;
  const store = readStore();
  const entry = store.entries.find((e) => e.id === modelId);
  if (!entry) return;
  const usd = Math.round(((entry.pricing.usd * billedUsd) / estimatedUsd) * 100000) / 100000;
  if (Math.abs(usd - entry.pricing.usd) < 1e-6) return;
  write({ media: store.media, llm: store.llm, observed: { ...store.observed, [modelId]: { usd, at: Date.now() } } });
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
  "openai/gpt-image-1.5/text-to-image",
  "black-forest-labs/flux-2-pro/edit",
  "bytedance/seedance-v1-pro-fast/image-to-video",
  "kwaivgi/kling-v2.5-turbo-pro/image-to-video",
  "bytedance/seedance-v1-pro-fast/text-to-video",
];

let seeding: Promise<void> | null = null;
export function ensureRecommended(): Promise<void> {
  const { media, llm } = readStore();
  if (media.length || llm.length) return Promise.resolve();
  seeding ??= (async () => {
    for (const id of RECOMMENDED) await enableModel(id).catch(() => undefined);
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}
