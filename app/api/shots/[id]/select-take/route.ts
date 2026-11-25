import { handle, json, parseBody } from "@/lib/api/http";
import { SelectTakeRequest } from "@/lib/api/inputs";
import { selectTake } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { takeId, nodeId } = await parseBody(req, SelectTakeRequest);
  return json(selectTake((await params).id, takeId, nodeId));
});
