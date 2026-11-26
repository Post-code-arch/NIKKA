import { START_IMAGE_FIELDS, findField } from "@/lib/atlas/schema-body";
import type { CatalogModel, ModelInputSchema, SchemaProperty } from "@/lib/atlas/schemas";
import { optionFields, parseSize, type ModelOptions } from "./options";
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
    /** Source video of a video → video model (string, or array of one). */
    video?: { name: string; array: boolean };
    /** Reference videos (array). `mixed`: one array for images and videos (MiniMax "refers"). */
    videoRefs?: { name: string; max: number; mixed?: boolean };
    startImage?: string;
    endImage?: string;
    duration?: { name: string; values: number[] };
  };
  /** Fixed values sent with every call (audio off…). */
  fixed: Record<string, unknown>;
  /** Format / definition / quality the user can pick in the node. */
  options?: ModelOptions;
  /** Version of the description rules (older stored descriptions are refreshed). */
  v?: number;
}

export interface LlmDescriptor {
  id: string;
  label: string;
  inputUsdPerM: number;
  outputUsdPerM: number;
  contextLength?: number;
}

const REF_ARRAY_FIELDS = ["images", "image_urls", "reference_images", "input_images", "reference_image_urls"] as const;
const VIDEO_FIELDS = ["video", "video_url", "input_video", "source_video", "videos", "video_urls"] as const;
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
    // Video in, video out (restyle / edit). Sound-only, extend, upscale and reframe are other tools.
    if (/music|sound|sfx|audio/.test(id)) return null;
    if (/video-to-video|video-edit|edit-video|\/v2v\b|restyle/.test(id)) return "v2v";
    // Images (and, for some, videos) as references: Seedance 2.x, Kling, Vidu, MiniMax…
    if (/reference-to-video|\/r2v\b/.test(id)) return "r2v";
    if (/image-to-video|(^|[/-])i2v([/-]|$)|start-end|first-last/.test(id)) return "i2v";
    if (/text-to-video|(^|[/-])t2v([/-]|$)/.test(id)) return "t2v";
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
  if (kind === "v2v") {
    const v = findField(schema, VIDEO_FIELDS);
    if (!v) throw new Error(`${m.model} : aucun champ de vidéo source dans le schéma`);
    fields.video = { name: claim(v)!, array: typeOf(props[v]) === "array" };
    // Optional reference images (characters, style).
    const refs = findField(schema, REF_ARRAY_FIELDS);
    if (refs) {
      const p = props[refs] as SchemaProperty & { maxItems?: number };
      fields.images = { name: claim(refs)!, array: true, max: Math.min(16, p.maxItems ?? 4) };
    }
  }
  if (kind === "r2v") {
    const imgs = findField(schema, REF_ARRAY_FIELDS);
    if (imgs) {
      const p = props[imgs] as SchemaProperty & { maxItems?: number };
      fields.images = { name: claim(imgs)!, array: true, max: Math.min(16, p.maxItems ?? 4) };
    }
    const vids = findField(schema, ["reference_videos", "video_references", "ref_videos"]);
    if (vids) {
      const p = props[vids] as SchemaProperty & { maxItems?: number };
      fields.videoRefs = { name: claim(vids)!, max: Math.min(8, p.maxItems ?? 1) };
    }
    // One list for every kind of reference (images and videos).
    if (!imgs && !vids && props.refers) {
      const p = props.refers as SchemaProperty & { maxItems?: number };
      fields.images = { name: claim("refers")!, array: true, max: Math.min(16, p.maxItems ?? 4) };
      fields.videoRefs = { name: "refers", max: Math.min(16, p.maxItems ?? 4), mixed: true };
    }
    if (!fields.images && !fields.videoRefs) throw new Error(`${m.model} : aucun champ de référence dans le schéma`);
    // Optional first frame (Kling): not used by NIKKA, never required.
  }
  if (kind === "i2v") {
    fields.startImage = claim(findField(schema, START_IMAGE_FIELDS));
    if (!fields.startImage) throw new Error(`${m.model} : aucun champ d'image de départ dans le schéma`);
    fields.endImage = claim(findField(schema, END_IMAGE_FIELDS));
  }
  if (kind === "i2v" || kind === "t2v" || kind === "v2v" || kind === "r2v") {
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
  const options = readOptions(props, kind);
  for (const o of [options.format, options.sizes, options.definition, options.quality]) if (o) used.add(o.field);
  // Generated audio costs extra and NIKKA mounts sound later.
  if (props.generate_audio && typeOf(props.generate_audio) === "boolean") {
    fixed.generate_audio = false;
    used.add("generate_audio");
  }

  const unfilled = (schema.required ?? []).filter((k) => !used.has(k) && props[k]?.default === undefined);
  if (unfilled.length) throw new Error(`${m.model} : champs requis non pris en charge (${unfilled.join(", ")})`);
  if (!fields.prompt && kind !== "i2v") throw new Error(`${m.model} : pas de champ prompt`);

  const video = kind === "i2v" || kind === "t2v" || kind === "v2v" || kind === "r2v";
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
    ...(Object.keys(options).length ? { options } : {}),
    v: DESCRIPTOR_VERSION,
  };
}

/** Bump when the rules change: stored descriptions older than this are rebuilt from their schema. */
export const DESCRIPTOR_VERSION = 2;

/** Format, definition and quality offered by the schema (enums only: nothing is guessed). */
function readOptions(props: ModelInputSchema["properties"], kind: MediaKind): ModelOptions {
  const o: ModelOptions = {};
  const enumOf = (p?: SchemaProperty) => (p?.enum ?? []).map(String);
  const def = (p?: SchemaProperty) => (p?.default !== undefined ? String(p.default) : undefined);
  for (const name of ["aspect_ratio", "ratio"]) {
    const values = enumOf(props[name]);
    if (values.length) {
      o.format = { field: name, values, default: def(props[name]) };
      break;
    }
  }
  // Image sizes as an enum of width × height (a free text size is left to the model).
  if (kind !== "i2v" && props.size) {
    const values = enumOf(props.size).flatMap((v) => {
      const s = parseSize(v);
      return s ? [{ value: v, ...s }] : [];
    });
    if (values.length) o.sizes = { field: "size", values, default: def(props.size) };
  }
  for (const name of ["resolution", "output_resolution"]) {
    const values = enumOf(props[name]);
    // Only real definitions (720p, 2K, 4k…), not named formats like "landscape_16_9".
    if (values.some((v) => /\d+\s*p\b|\dk\b/i.test(v))) {
      o.definition = { field: name, values, default: def(props[name]) };
      break;
    }
  }
  const q = enumOf(props.quality);
  if (q.length) o.quality = { field: "quality", values: q, default: def(props.quality) };
  return o;
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
    maxReferenceVideos: f.videoRefs?.max,
    supportsStartEndFrames: !!f.endImage,
    durations: f.duration?.values,
    options: d.options,
    mapInputs: (g: GenericInputs) => {
      const body: Record<string, unknown> = {
        ...d.fixed,
        ...optionFields(d.options, { aspectRatio: g.aspectRatio, resolution: g.resolution, quality: g.quality }),
      };
      if (f.prompt) body[f.prompt] = g.prompt;
      if (f.negativePrompt && g.negativePrompt) body[f.negativePrompt] = g.negativePrompt;
      if (f.seed && g.seed !== undefined) body[f.seed] = g.seed;
      if (f.images && g.referenceImageUrls?.length) {
        body[f.images.name] = f.images.array ? g.referenceImageUrls.slice(0, f.images.max) : g.referenceImageUrls[0];
      }
      if (f.startImage && g.startImageUrl) body[f.startImage] = g.startImageUrl;
      if (f.video && g.sourceVideoUrl) body[f.video.name] = f.video.array ? [g.sourceVideoUrl] : g.sourceVideoUrl;
      // Reference → video used as video → video: the source video is the first reference video.
      const refVideos = [...(!f.video && g.sourceVideoUrl ? [g.sourceVideoUrl] : []), ...(g.referenceVideoUrls ?? [])];
      if (f.videoRefs && refVideos.length) {
        const vids = refVideos.slice(0, f.videoRefs.max);
        if (f.videoRefs.mixed) body[f.videoRefs.name] = [...((body[f.videoRefs.name] as string[] | undefined) ?? []), ...vids].slice(0, f.videoRefs.max);
        else body[f.videoRefs.name] = vids;
      }
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
