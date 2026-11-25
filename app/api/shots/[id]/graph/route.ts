import { handle, json, parseBody } from "@/lib/api/http";
import { ensureShotGraph, writeGraph } from "@/lib/graph/run";
import { z } from "zod";

type Ctx = { params: Promise<{ id: string }> };

/** The shot's sub-graph (built from its recipe on first access). */
export const GET = handle(async (_req: Request, { params }: Ctx) => json(ensureShotGraph((await params).id)));

/** Saves an edited graph (positions, nodes, links); refIds follow Reference nodes. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { graph } = await parseBody(req, z.object({ graph: z.unknown() }));
  return json({ graph: writeGraph((await params).id, graph) });
});
