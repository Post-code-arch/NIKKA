import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { moveShot } from "@/lib/storyboard/ops";

type Ctx = { params: Promise<{ id: string }> };

/** Moves a shot to a position, in its sequence or another one. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { sequenceId, index } = await parseBody(req, z.object({ sequenceId: z.string().min(1), index: z.number().int().min(0) }));
  moveShot((await params).id, sequenceId, index);
  return json({ ok: true });
});
