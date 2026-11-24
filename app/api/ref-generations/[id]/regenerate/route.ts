import { handle, json, parseBody } from "@/lib/api/http";
import { RegenerateRequest } from "@/lib/api/inputs";
import { regenerateView } from "@/lib/refs/pack";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { confirmedCostUsd } = await parseBody(req, RegenerateRequest);
  return json(await regenerateView((await params).id, confirmedCostUsd), { status: 201 });
});
