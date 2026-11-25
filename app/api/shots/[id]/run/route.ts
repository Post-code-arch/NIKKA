import { handle, json, parseBody } from "@/lib/api/http";
import { RunRequest } from "@/lib/api/inputs";
import { runShot } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** Estimate (estimateOnly) or run a generation node of the shot graph, ×variants. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const input = await parseBody(req, RunRequest);
  const result = await runShot((await params).id, input);
  return json(result, { status: input.estimateOnly ? 200 : 201 });
});
