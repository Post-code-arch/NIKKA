import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { insertTemplate } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

const TemplateRequest = z.object({
  recipeId: z.enum(["character", "location", "object", "continuity", "free"]),
  x: z.number().default(0),
  y: z.number().default(0),
});

/** Inserts a recipe template in the shot's canvas. */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { recipeId, x, y } = await parseBody(req, TemplateRequest);
  return json({ graph: insertTemplate((await params).id, recipeId, { x, y }) });
});
