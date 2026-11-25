import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { getCanvas, writeGraph } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** The project's node canvas and its results. */
export const GET = handle(async (_req: Request, { params }: Ctx) => json(getCanvas((await params).id)));

/** Saves the edited canvas (nodes, positions, links). */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { graph } = await parseBody(req, z.object({ graph: z.unknown() }));
  return json({ graph: writeGraph((await params).id, graph) });
});
