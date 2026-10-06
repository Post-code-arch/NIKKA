import { handle, json } from "@/lib/api/http";
import { isMockMode } from "@/lib/atlas/config";
import { availableModels, toModelInfo } from "@/lib/models/registry";
import type { ModelKind } from "@/lib/models/types";

export const GET = handle(async (req: Request) => {
  const kind = new URL(req.url).searchParams.get("kind") as ModelKind | null;
  return json({ mock: isMockMode(), models: availableModels(kind ?? undefined).map(toModelInfo) });
});
