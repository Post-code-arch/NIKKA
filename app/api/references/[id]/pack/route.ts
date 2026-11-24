import { handle, json, parseBody } from "@/lib/api/http";
import { PackRequest } from "@/lib/api/inputs";
import { estimatePack, launchPack } from "@/lib/refs/pack";

type Ctx = { params: Promise<{ id: string }> };

/** Estimate (estimateOnly) or launch the generation of standard views. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { estimateOnly, ...input } = await parseBody(req, PackRequest);
  if (estimateOnly) return json(estimatePack({ referenceId: id, ...input }));
  return json(await launchPack({ referenceId: id, ...input }), { status: 201 });
});
