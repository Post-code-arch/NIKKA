import { z } from "zod";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { analyzeBrief, chooseConcept, proposeLevel, validateLevel } from "@/lib/digester/service";

type Ctx = { params: Promise<{ id: string; action: string }> };

const level = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/** analyze {briefRaw} · propose {level} · choose {index} · validate {level} */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id, action } = await params;
  switch (action) {
    case "analyze":
      return json(await analyzeBrief(id, (await parseBody(req, z.object({ briefRaw: z.string().max(100_000) }))).briefRaw));
    case "propose":
      return json(await proposeLevel(id, (await parseBody(req, z.object({ level }))).level));
    case "choose":
      return json(chooseConcept(id, (await parseBody(req, z.object({ index: z.number().int().min(0) }))).index));
    case "validate":
      return json(validateLevel(id, (await parseBody(req, z.object({ level }))).level));
    default:
      return notFound("Action");
  }
});
