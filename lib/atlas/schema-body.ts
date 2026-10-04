import type { ModelInputSchema, SchemaProperty } from "./schemas";

/**
 * Helpers to build a request body strictly from a model's published input
 * schema: only fields present in the schema are ever sent.
 */

export const START_IMAGE_FIELDS = [
  "image",
  "image_url",
  "first_frame_image",
  "first_frame",
  "start_image",
  "start_image_url",
] as const;

export function findField(schema: ModelInputSchema, candidates: readonly string[]): string | undefined {
  return candidates.find((c) => c in schema.properties);
}

function typeOf(p: SchemaProperty): string | undefined {
  return Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type;
}

/** Smallest value of a numeric (or "480p"-like) property, for cheapest runs. */
export function smallestValue(p: SchemaProperty): unknown {
  if (p.enum && p.enum.length > 0) {
    const scored = p.enum.map((v) => ({ v, n: typeof v === "number" ? v : parseFloat(String(v)) }));
    if (scored.every((s) => Number.isFinite(s.n))) {
      return scored.reduce((a, b) => (b.n < a.n ? b : a)).v;
    }
    return p.default ?? p.enum[0];
  }
  if (typeof p.minimum === "number" && (typeOf(p) === "integer" || typeOf(p) === "number")) return p.minimum;
  return p.default;
}

/** Required fields that are neither provided nor defaulted by the schema. */
export function missingRequired(schema: ModelInputSchema, provided: Record<string, unknown>): string[] {
  return (schema.required ?? []).filter(
    (k) => provided[k] === undefined && schema.properties[k]?.default === undefined,
  );
}

/**
 * Returns `{ model, ...params }` keeping only schema fields and filling
 * required fields from their defaults. Throws if a required field is missing
 * or a param is not in the schema.
 */
export function buildBody(
  modelId: string,
  schema: ModelInputSchema,
  params: Record<string, unknown>,
): { model: string } & Record<string, unknown> {
  const unknown = Object.keys(params).filter((k) => !(k in schema.properties));
  if (unknown.length) throw new Error(`${modelId}: params not in schema: ${unknown.join(", ")}`);
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body[k] = v;
  for (const k of schema.required ?? []) {
    if (body[k] === undefined && schema.properties[k]?.default !== undefined) {
      body[k] = schema.properties[k].default;
    }
  }
  const missing = missingRequired(schema, body);
  if (missing.length) throw new Error(`${modelId}: missing required params: ${missing.join(", ")}`);
  return { model: modelId, ...body };
}
