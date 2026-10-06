import { handle, json, parseBody } from "@/lib/api/http";
import { TakeEstimate } from "@/lib/api/inputs";
import { estimateTake } from "@/lib/generation/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(req, TakeEstimate);
  return json(estimateTake({ shotId: id, ...input }));
});
