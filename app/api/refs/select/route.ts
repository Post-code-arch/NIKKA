import { handle, json, parseBody } from "@/lib/api/http";
import { SelectPreviewRequest } from "@/lib/api/inputs";
import { previewSelection } from "@/lib/refs/preview";

/** Which views would be sent for a shot of this scale/angle with this slot budget. */
export const POST = handle(async (req: Request) => {
  const { refs, scale, angle, maxSlots } = await parseBody(req, SelectPreviewRequest);
  return json(previewSelection(refs, { scale, angle }, maxSlots));
});
