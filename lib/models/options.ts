/**
 * Output options a model accepts, read from its schema: format (aspect
 * ratio), definition (1K/2K/4K for images, 480p…4K for videos) and quality.
 * Pure and client-safe: the node shows the choices, the server builds the
 * request with the same rules.
 */

export interface ModelOptions {
  /** aspect_ratio / ratio enum, values as the schema spells them. */
  format?: { field: string; values: string[]; default?: string };
  /** size enum (images): width × height; gives formats and 1K/2K/4K tiers. */
  sizes?: { field: string; values: { value: string; w: number; h: number }[]; default?: string };
  /** resolution enum: 1K/2K/4K, or 480p/720p/1080p/4k (videos). */
  definition?: { field: string; values: string[]; default?: string };
  /** quality enum (low…max). */
  quality?: { field: string; values: string[]; default?: string };
}

/** What the user picked in the node (undefined = the model's default). */
export interface OptionChoice {
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
}

const RATIOS: [string, number][] = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
];

/** "1536x864" or "1536*864" → { w, h }. */
export function parseSize(v: string): { w: number; h: number } | null {
  const [w, h] = v.split(/[x*×]/).map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
}

export function ratioLabel(w: number, h: number): string {
  const r = w / h;
  return RATIOS.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a))[0];
}

/** Image definition tier by pixel count. */
export function tierOf(w: number, h: number): "1K" | "2K" | "4K" {
  const mp = (w * h) / 1e6;
  return mp < 2.5 ? "1K" : mp < 6.5 ? "2K" : "4K";
}

const TIER_ORDER = ["1K", "2K", "4K"];
const RATIO_ORDER = RATIOS.map((r) => r[0]);

function videoRank(v: string) {
  const m = v.toLowerCase().match(/(\d+)\s*p|(\d)k/);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : Number(m[2]) * 1000;
}

/** Friendly label for a definition value ("1080p-esr" → "1080p (upscalé)"). */
export function definitionLabel(v: string): string {
  // -sr: plain upscale; -esr: enhanced upscale (more detail, pricier).
  const up = v.match(/-(e?sr)\b/i)?.[1]?.toLowerCase();
  const base = v.replace(/-(e?sr)\b/i, "").replace(/\s*&\s*/g, " ").toUpperCase().replace(/P\b/, "p").replace(/(\d)K\b/, "$1K");
  return up === "esr" ? `${base} (upscalé +)` : up ? `${base} (upscalé)` : base;
}

export interface OptionChoices {
  formats: string[];
  definitions: string[];
  qualities: string[];
  /** The choice the model uses when nothing is picked. */
  defaults: Required<OptionChoice>;
}

/** The choices offered in a node for a model, with the model's defaults. */
export function choicesOf(o: ModelOptions | undefined): OptionChoices {
  const formats = new Set<string>();
  const definitions = new Set<string>();
  o?.format?.values.forEach((v) => formats.add(v));
  o?.sizes?.values.forEach((s) => {
    formats.add(ratioLabel(s.w, s.h));
    definitions.add(tierOf(s.w, s.h));
  });
  o?.definition?.values.forEach((v) => definitions.add(v));
  const qualities = (o?.quality?.values ?? []).filter((v) => v !== "auto");
  const sortedFormats = [...formats]
    .filter((v) => v !== "auto")
    .sort((a, b) => (RATIO_ORDER.indexOf(a) + 100 * +(RATIO_ORDER.indexOf(a) < 0)) - (RATIO_ORDER.indexOf(b) + 100 * +(RATIO_ORDER.indexOf(b) < 0)));
  const sortedDefs = [...definitions].sort((a, b) =>
    TIER_ORDER.includes(a) && TIER_ORDER.includes(b) ? TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b) : videoRank(a) - videoRank(b) || a.localeCompare(b),
  );
  const sizeDefault = o?.sizes?.default ? parseSize(o.sizes.default) : null;
  // NIKKA's default frame is 16:9 when the model offers it (cinema), else the model's own default.
  // Otherwise the landscape format closest to 16:9, else the model's own default.
  const landscape = sortedFormats
    .map((f) => ({ f, r: RATIOS.find((x) => x[0] === f)?.[1] }))
    .filter((x): x is { f: string; r: number } => !!x.r && x.r > 1)
    .sort((a, b) => Math.abs(a.r - 16 / 9) - Math.abs(b.r - 16 / 9))[0]?.f;
  const defFormat = sortedFormats.includes("16:9")
    ? "16:9"
    : (landscape ?? o?.format?.default ?? (sizeDefault ? ratioLabel(sizeDefault.w, sizeDefault.h) : (sortedFormats[0] ?? "")));
  return {
    formats: sortedFormats,
    definitions: sortedDefs,
    qualities,
    defaults: {
      aspectRatio: defFormat,
      resolution: o?.definition?.default ?? (sizeDefault ? tierOf(sizeDefault.w, sizeDefault.h) : (sortedDefs[0] ?? "")),
      quality: o?.quality?.default && o.quality.default !== "auto" ? o.quality.default : (qualities[0] ?? ""),
    },
  };
}

/** The choice actually used: the user's pick when the model offers it, else the default. */
export function resolveChoice(o: ModelOptions | undefined, pick: OptionChoice): Required<OptionChoice> {
  const c = choicesOf(o);
  return {
    aspectRatio: pick.aspectRatio && c.formats.includes(pick.aspectRatio) ? pick.aspectRatio : c.defaults.aspectRatio,
    resolution: pick.resolution && c.definitions.includes(pick.resolution) ? pick.resolution : c.defaults.resolution,
    quality: pick.quality && c.qualities.includes(pick.quality) ? pick.quality : c.defaults.quality,
  };
}

/** Request fields for a choice (size picked by format then definition). */
export function optionFields(o: ModelOptions | undefined, pick: OptionChoice): Record<string, string> {
  if (!o) return {};
  const c = resolveChoice(o, pick);
  const out: Record<string, string> = {};
  if (o.format && c.aspectRatio && o.format.values.includes(c.aspectRatio)) out[o.format.field] = c.aspectRatio;
  if (o.definition && c.resolution && o.definition.values.includes(c.resolution)) out[o.definition.field] = c.resolution;
  if (o.quality && c.quality && o.quality.values.includes(c.quality)) out[o.quality.field] = c.quality;
  if (o.sizes?.values.length) {
    const target = RATIOS.find((r) => r[0] === c.aspectRatio)?.[1] ?? 16 / 9;
    const sameTier = o.sizes.values.filter((s) => tierOf(s.w, s.h) === c.resolution);
    const pool = sameTier.length ? sameTier : o.sizes.values;
    const best = pool.reduce((a, b) => (Math.abs(b.w / b.h - target) < Math.abs(a.w / a.h - target) ? b : a));
    out[o.sizes.field] = best.value;
  }
  return out;
}

/** Price key of a choice: definition and quality change the bill, the format does not. */
export function optionKey(o: ModelOptions | undefined, pick: OptionChoice): string {
  if (!o) return "";
  const c = resolveChoice(o, pick);
  return [o.definition || o.sizes ? c.resolution : "", o.quality ? c.quality : ""].filter(Boolean).join(" · ");
}

/** The same key, read back from a request body (to learn the price of what was billed). */
export function optionKeyFromBody(o: ModelOptions | undefined, body: Record<string, unknown>): string {
  if (!o) return "";
  let resolution = "";
  if (o.definition) resolution = String(body[o.definition.field] ?? o.definition.default ?? "");
  else if (o.sizes) {
    const s = parseSize(String(body[o.sizes.field] ?? o.sizes.default ?? ""));
    resolution = s ? tierOf(s.w, s.h) : "";
  }
  const quality = o.quality ? String(body[o.quality.field] ?? o.quality.default ?? "") : "";
  return [resolution, quality].filter(Boolean).join(" · ");
}
