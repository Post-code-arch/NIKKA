import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { isMockMode } from "@/lib/atlas/config";
import { GenerationError } from "@/lib/generation/service";
import { disableModel, enableModel } from "@/lib/models/store";

/** Enables a catalog model: its adapter is built from its published schema. */
export const POST = handle(async (req: Request) => {
  if (isMockMode()) throw new GenerationError("Le catalogue Atlas se branche en mode réel (NIKKA_MOCK_ATLAS=0)", 400);
  const { id } = await parseBody(req, z.object({ id: z.string().min(3) }));
  try {
    return json(await enableModel(id), { status: 201 });
  } catch (e) {
    throw new GenerationError(e instanceof Error ? e.message : String(e), 422);
  }
});

export const DELETE = handle(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) disableModel(id);
  return new Response(null, { status: 204 });
});
