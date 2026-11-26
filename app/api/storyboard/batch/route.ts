import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { launchBatch, planBatch } from "@/lib/storyboard/ops";

const Body = z.object({
  shotIds: z.array(z.string().min(1)).min(1).max(200),
  stage: z.enum(["sketch", "keyframe", "video"]),
  estimateOnly: z.boolean().optional(),
  confirmedTotalUsd: z.number().nonnegative().optional(),
});

/** Staged batch generation: estimate the total first, then launch once confirmed. */
export const POST = handle(async (req: Request) => {
  const input = await parseBody(req, Body);
  if (input.estimateOnly) return json(planBatch(input.shotIds, input.stage));
  return json(await launchBatch(input.shotIds, input.stage, input.confirmedTotalUsd), { status: 201 });
});
