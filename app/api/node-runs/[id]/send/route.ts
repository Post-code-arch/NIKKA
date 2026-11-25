import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { sendToShot } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** Sends a canvas result to a shot of the storyboard, as a take. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { shotId } = await parseBody(req, z.object({ shotId: z.string().min(1) }));
  return json(sendToShot((await params).id, shotId), { status: 201 });
});
