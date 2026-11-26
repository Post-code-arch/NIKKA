import { handle, json } from "@/lib/api/http";
import { isMockMode } from "@/lib/atlas/config";
import { listModels, unitPrice } from "@/lib/atlas/catalog";
import { classify } from "@/lib/models/catalog-adapter";
import { availableLlms, availableModels } from "@/lib/models/registry";

export interface CatalogItem {
  id: string;
  label: string;
  org: string;
  kind: string;
  usd: number | null;
  unit: string | null;
  enabled: boolean;
  tags: string[];
}

/** Search the Atlas catalog for one kind of model (t2i, i2i, t2v, i2v, llm). */
export const GET = handle(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const kind = params.get("kind");
  const q = (params.get("q") ?? "").trim().toLowerCase();
  if (isMockMode()) return json({ mock: true, items: [] as CatalogItem[] });
  const enabled = new Set([...availableModels().map((m) => m.id), ...availableLlms().map((m) => m.id)]);
  const items = (await listModels())
    .filter((m) => classify(m) === kind)
    .filter((m) => !q || `${m.model} ${m.displayName ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => Number((b as { priority?: number }).priority ?? 0) - Number((a as { priority?: number }).priority ?? 0))
    .slice(0, 60)
    .map((m): CatalogItem => {
      const llm = kind === "llm" ? ((m.price?.actual ?? m.price?.origin) as { output_price?: string } | undefined) : undefined;
      const price = llm ? { usd: Number(llm.output_price ?? NaN), unit: "M tokens (sortie)" } : unitPrice(m);
      return {
        id: m.model,
        label: m.displayName || m.model,
        org: m.model.split("/")[0],
        kind: kind!,
        usd: price && Number.isFinite(price.usd) ? price.usd : null,
        unit: price?.unit ?? null,
        enabled: enabled.has(m.model),
        tags: (m.tags ?? []).slice(0, 3),
      };
    });
  return json({ mock: false, items });
});
