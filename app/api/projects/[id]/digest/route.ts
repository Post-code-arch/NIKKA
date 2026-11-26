import { z } from "zod";
import { handle, json, parseBody } from "@/lib/api/http";
import { getDigest, updateLevel } from "@/lib/digester/service";

type Ctx = { params: Promise<{ id: string }> };

/** The project's brief and digester state. */
export const GET = handle(async (_req: Request, { params }: Ctx) => json(getDigest((await params).id)));

/** Inline edits of one level. */
export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const { level, data } = await parseBody(req, z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), data: z.unknown() }));
  return json(updateLevel((await params).id, level, data));
});
