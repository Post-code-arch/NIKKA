import { START_IMAGE_FIELDS, findField } from "@/lib/atlas/schema-body";
import type { CatalogModel, ModelInputSchema, SchemaProperty } from "@/lib/atlas/schemas";
import type { GenericInputs, ModelEntry, ModelKind, ModelTier } from "./types";

/**
 * Turns an Atlas catalog model + its published input schema into a NIKKA
 * model entry. Only fields that exist in the schema are ever sent; a model
 * whose required fields cannot be filled is refused (never guessed).
 */

export type MediaKind = Exclude<ModelKind, "llm">;

/** JSON-serialisable description of how to call a model (stored locally). */
export interface ModelDescriptor {
  id: string;
  label: string;
  kind: MediaKind;
  endpoint: "generateImage" | "generateVideo";
  tier: ModelTier;
  pricing: { unit: "image" | "second" | "request"; usd: number };
  /** The catalog gave no unit: the conservative one was assumed. */
  priceUnitAssumed?: boolean;
  fields: {
    prompt?: string;
    negativePrompt?: string;
    seed?: string;
    /** Several reference images (array) or a single one (string). */
    images?: { name: string; array: boolean; max: number };
    startImage?: string;
    endImage?: string;
    duration?: { name: string; values: number[] };
  };
  /** Fixed values sent with every call (aspect ratio, audio off…). */
  fixed: Record<string, unknown>;
}

export interface LlmDescriptor {
  id: string;
  label: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
  contextLength?: number;
}

const REF_ARRAY_FIELDS = ["images", "image_urls", "reference_images", "input_images", "reference_image_urls"] as const;
const END_IMAGE_FIELDS = ["last_image", "end_image", "end_image_url", "last_frame_image", "tail_image", "last_frame"] as const;

function typeOf(p: SchemaProperty): string | undefined {
  return Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
}

/** Kind from the catalog entry (type + endpoint name). */
export function classify(m: Pick<CatalogModel, "model" | "type">): ModelKind | null {
  const id = m.model.toLowerCase();
  if (m.type === "Text") return "llm";
  if (m.type === "Image") {
    if (/text-to-image|\/t2i\b|generate$/.test(id)) return "t2i";
    if (/edit|image-to-image|\/i2i\b|reference/.test(id)) return "i2i";
    return null;
  }
  if (m.type === "Video") {
    if (/image-to-video|\/i2v\b|start-end|first-last/.test(id)) return "i2v";
    if (/text-to-video|\/t2v\b/.test(id)) return "t2v";
    return null;
  }
  return null;
}

function label(m: CatalogModel) {
  const name = m.displayName || m.model.split("/").slice(-2).join(" ");
  const variant = m.model.split("/").pop() ?? "";
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(name).includes(norm(variant)) ? name : `${name} · ${variant}`;
}

function numericEnum(p: SchemaProperty): number[] {
  return (p.enum ?? []).map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
}

/** A 16:9-ish value for an aspect / size field, when the schema allows one. */
function landscape(name: string, p: SchemaProperty): unknown {
  const values = (p.enum ?? []).map(String);
  if (name === "aspect_ratio" || name === "ratio") return values.includes("16:9") ? "16:9" : undefined;
  if (name === "size") {
    const sizes = values
      .map((v) => {
        const [w, h] = v.split(/[x*]/).map(Number);
        return { v, r: w / h };
      })
      .filter((s) => Number.isFinite(s.r) && s.r > 1.2);
    if (sizes.length) return sizes.sort((a, b) => Math.abs(a.r - 16 / 9) - Math.abs(b.r - 16 / 9))[0].v;
  }
  return undefined;
}

export function describe(m: CatalogModel, schema: ModelInputSchema, price: { usd: number; unit?: string } | null): ModelDescriptor {
  const kind = classify(m);
  if (!kind || kind === "llm") throw new Error(`${m.model} : type de modèle non pris en charge`);
  const props = schema.properties;
  const fields: ModelDescriptor["fields"] = {};
  const used = new Set<string>(["model"]);
  const claim = (name: string | undefined) => {
    if (name) used.add(name);
    return name;
  };

  fields.prompt = claim(findField(schema, ["prompt"]));
  fields.negativePrompt = claim(findField(schema, ["negative_prompt"]));
  fields.seed = claim(findField(schema, ["seed"]));

  if (kind === "i2i") {
    const arr = findField(schema, REF_ARRAY_FIELDS);
    if (arr) {
      const p = props[arr] as SchemaProperty & { maxItems?: number };
      fields.images = { name: claim(arr)!, array: true, max: Math.min(16, p.maxItems ?? 4) };
    } else {
      const single = findField(schema, ["image", "image_url", "input_image"]);
      if (!single) throw new Error(`${m.model} : aucun champ d'image de référence dans le schéma`);
      fields.images = { name: claim(single)!, array: false, max: 1 };
    }
  }
  if (kind === "i2v") {
    fields.startImage = claim(findField(schema, START_IMAGE_FIELDS));
    if (!fields.startImage) throw new Error(`${m.model} : aucun champ d'image de départ dans le schéma`);
    fields.endImage = claim(findField(schema, END_IMAGE_FIELDS));
  }
  if (kind === "i2v" || kind === "t2v") {
    const d = props.duration;
    if (d) {
      let values = numericEnum(d);
      if (!values.length && typeof d.minimum === "number" && typeof d.maximum === "number") {
        values = Array.from({ length: Math.min(30, d.maximum - d.minimum + 1) }, (_, i) => d.minimum! + i).filter((n) => n > 0);
      }
      if (values.length) fields.duration = { name: claim("duration")!, values };
    }
  }

  const fixed: Record<string, unknown> = {};
  for (const name of ["aspect_ratio", "ratio", "size"]) {
    if (!props[name] || (name === "size" && kind === "i2v")) continue;
    const v = landscape(name, props[name]);
    if (v !== undefined) {
      fixed[name] = v;
      used.add(name);
    }
  }
  // Generated audio costs extra and NIKKA mounts sound later.
  if (props.generate_audio && typeOf(props.generate_audio) === "boolean") {
    fixed.generate_audio = false;
    used.add("generate_audio");
  }

  const unfilled = (schema.required ?? []).filter((k) => !used.has(k) && props[k]?.default === undefined);
  if (unfilled.length) throw new Error(`${m.model} : champs requis non pris en charge (${unfilled.join(", ")})`);
  if (!fields.prompt && kind !== "i2v") throw new Error(`${m.model} : pas de champ prompt`);

  const video = kind === "i2v" || kind === "t2v";
  const unit = price?.unit === "image" || price?.unit === "second" ? price.unit : video ? "second" : "image";
  const usd = price?.usd ?? 0;
  return {
    id: m.model,
    label: label(m),
    kind,
    endpoint: video ? "generateVideo" : "generateImage",
    tier: kind === "t2i" && usd < 0.01 ? "sketch" : video ? "draft" : "quality",
    pricing: { unit, usd },
    ...(price?.unit ? {} : { priceUnitAssumed: true }),
    fields,
    fixed,
  };
}

function closest(values: number[], target: number) {
  return values.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

export function entryFromDescriptor(d: ModelDescriptor): ModelEntry {
  const f = d.fields;
  return {
    id: d.id,
    label: d.label,
    kind: d.kind,
    tier: d.tier,
    endpoint: d.endpoint,
    pricing: d.pricing,
    supportsSeed: !!f.seed,
    supportsNegativePrompt: !!f.negativePrompt,
    maxReferenceImages: f.images?.max,
    supportsStartEndFrames: !!f.endImage,
    durations: f.duration?.values,
    mapInputs: (g: GenericInputs) => {
      const body: Record<string, unknown> = { ...d.fixed };
      if (f.prompt) body[f.prompt] = g.prompt;
      if (f.negativePrompt && g.negativePrompt) body[f.negativePrompt] = g.negativePrompt;
      if (f.seed && g.seed !== undefined) body[f.seed] = g.seed;
      if (f.images && g.referenceImageUrls?.length) {
        body[f.images.name] = f.images.array ? g.referenceImageUrls.slice(0, f.images.max) : g.referenceImageUrls[0];
      }
      if (f.startImage && g.startImageUrl) body[f.startImage] = g.startImageUrl;
      if (f.endImage && g.endImageUrl) body[f.endImage] = g.endImageUrl;
      if (f.duration && g.durationSec) body[f.duration.name] = closest(f.duration.values, g.durationSec);
      return body;
    },
  };
}

/** LLM price from the catalog ("flat" per million tokens). */
export function describeLlm(m: CatalogModel & { contextLength?: number }): LlmDescriptor {
  const side = (m.price?.actual ?? m.price?.origin ?? {}) as { input_price?: string | number; output_price?: string | number };
  return {
    id: m.model,
    label: m.displayName || m.model,
    inputUsdPerM: Number(side.input_price ?? 0) || 0,
    outputUsdPerM: Number(side.output_price ?? 0) || 0,
    contextLength: m.contextLength,
  };
}
