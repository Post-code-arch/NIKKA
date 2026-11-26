import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { enhanceNode } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** Runs a Prompt enhancer node (LLM): returns and stores the enhanced prompt. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { nodeId } = await parseBody(req, z.object({ nodeId: z.string().min(1) }));
  return json(await enhanceNode((await params).id, nodeId));
});
