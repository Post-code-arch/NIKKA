import { assertServer, isMockMode } from "./config";
import { AtlasError, atlasJson, atlasRequest } from "./http";
import { MOCK_CATALOG, MOCK_SCHEME, mockSchema } from "./mock";
import {
  CatalogResponseSchema,
  ModelInputSchemaSchema,
  type CatalogModel,
  type ModelInputSchema,
} from "./schemas";

/**
 * Live model catalog and per-model input schemas. Used to verify the model
 * registry instead of guessing IDs or parameter names.
 */

let cache: { at: number; models: CatalogModel[] } | null = null;
const TTL_MS = 5 * 60_000;

export async function listModels(): Promise<CatalogModel[]> {
  assertServer();
  if (isMockMode()) return MOCK_CATALOG;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.models;
  const res = await atlasJson(CatalogResponseSchema, "/models", { auth: false });
  const models = res.data.filter((m) => m.display_console !== false);
  cache = { at: Date.now(), models };
  return models;
}

export async function findModel(id: string): Promise<CatalogModel | undefined> {
  return (await listModels()).find((m) => m.model === id);
}

/** Reads `components.schemas.Input` from the model's OpenAPI document. */
export async function getModelInputSchema(model: CatalogModel): Promise<ModelInputSchema> {
  if (!model.schema) throw new AtlasError(`Model ${model.model} exposes no schema`);
  let doc: unknown;
  if (model.schema.startsWith(MOCK_SCHEME)) {
    doc = mockSchema(model.schema);
  } else {
    const res = await atlasRequest(model.schema, { auth: false });
    if (!res.ok) throw new AtlasError(`Schema fetch failed for ${model.model}`, res.status);
    doc = res.body;
  }
  const input = (doc as { components?: { schemas?: { Input?: unknown } } })?.components?.schemas?.Input;
  const parsed = ModelInputSchemaSchema.safeParse(input);
  if (!parsed.success) {
    throw new AtlasError(`Unexpected schema shape for ${model.model}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export interface UnitPrice {
  usd: number;
  unit: string;
}

/** Unit price from the catalog entry (discounted "actual" price first). */
export function unitPrice(model: CatalogModel): UnitPrice | null {
  for (const side of [model.price?.actual, model.price?.origin]) {
    if (!side) continue;
    const raw = side.base_price ?? side.output_image_price ?? side.request_price;
    const usd = raw !== undefined ? Number(raw) : NaN;
    if (Number.isFinite(usd)) return { usd, unit: side.unit ?? "generation" };
  }
  return null;
}
