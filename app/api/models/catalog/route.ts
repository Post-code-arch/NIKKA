import { handle, json } from "@/lib/api/http";
import { isMockMode } from "@/lib/atlas/config";
import { getModelInputSchema, listModels, unitPrice } from "@/lib/atlas/catalog";
import type { CatalogModel } from "@/lib/atlas/schemas";
import { classify, describe, entryFromDescriptor } from "@/lib/models/catalog-adapter";
import { availableLlms, availableModels } from "@/lib/models/registry";

export interface ModelCaps {
  refs?: number;
  videoRefs?: number;
  negative?: boolean;
  startEnd?: boolean;
  seed?: boolean;
}

export interface CatalogItem {
  id: string;
  label: string;
  org: string;
  kind: string;
  usd: number | null;
  unit: string | null;
  enabled: boolean;
  tags: string[];
  /** From the model's schema; null when NIKKA cannot drive it. */
  caps: ModelCaps | null;
  incompatible?: string;
}

/** Capabilities read from each schema, cached for the server's lifetime. */
const capsCache = new Map<string, { caps: ModelCaps | null; incompatible?: string }>();

async function capsOf(m: CatalogModel) {
  const hit = capsCache.get(m.model);
  if (hit) return hit;
  let out: { caps: ModelCaps | null; incompatible?: string };
  try {
    const e = entryFromDescriptor(describe(m, await getModelInputSchema(m), unitPrice(m)));
    out = {
      caps: { refs: e.maxReferenceImages, videoRefs: e.maxReferenceVideos, negative: e.supportsNegativePrompt, startEnd: e.supportsStartEndFrames, seed: e.supportsSeed },
    };
  } catch (err) {
    out = { caps: null, incompatible: err instanceof Error ? err.message : String(err) };
  }
  capsCache.set(m.model, out);
  return out;
}

/** Search the Atlas catalog for one or several kinds (t2i, i2i, t2v, i2v, llm). */
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const kinds = (params.get("kind") ?? "").split(",").filter(Boolean);
  const q = (params.get("q") ?? "").trim().toLowerCase();
  if (isMockMode()) return json({ mock: true, items: [] as CatalogItem[] });
  const enabled = new Set([...availableModels().map((m) => m.id), ...availableLlms().map((m) => m.id)]);
  const found = (await listModels())
    .filter((m) => kinds.includes(classify(m) ?? ""))
    .filter((m) => !q || `${m.model} ${m.displayName ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number((b as { priority?: number }).priority ?? 0) - Number((a as { priority?: number }).priority ?? 0))
    .slice(0, 40);
  const items = await Promise.all(
    found.map(async (m): Promise<CatalogItem> => {
      const kind = classify(m)!;
      const llm = kind === "llm" ? ((m.price?.actual ?? m.price?.origin) as { output_price?: string } | undefined) : undefined;
      const price = llm ? { usd: Number(llm.output_price ?? NaN), unit: "M tokens (sortie)" } : unitPrice(m);
      const caps = kind === "llm" ? { caps: {} } : await capsOf(m);
      return {
        id: m.model,
        label: m.displayName || m.model,
        org: m.model.split("/")[0],
        kind,
        usd: price && Number.isFinite(price.usd) ? price.usd : null,
        unit: price?.unit ?? null,
        enabled: enabled.has(m.model),
        tags: (m.tags ?? []).slice(0, 3),
        ...caps,
      };
    }),
  );
  return json({ mock: false, items });
});
