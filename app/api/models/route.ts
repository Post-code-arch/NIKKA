import { handle, json } from "@/lib/api/http";
import { isMockMode } from "@/lib/atlas/config";
import { availableLlms, availableModels, toModelInfo } from "@/lib/models/registry";
import { ensureRecommended } from "@/lib/models/store";
import type { ModelKind } from "@/lib/models/types";

/** Models usable now: mock ones, or the Atlas models enabled from the catalog (+ LLMs). */
export const GET = handle(async (req: Request) => {
  if (!isMockMode()) await ensureRecommended();
  const kind = new URL(req.url).searchParams.get("kind") as ModelKind | null;
  return json({ mock: isMockMode(), models: availableModels(kind ?? undefined).map(toModelInfo), llms: availableLlms() });
});
