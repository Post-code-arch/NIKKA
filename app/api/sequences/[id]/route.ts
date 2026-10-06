import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { SequenceUpdate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(req, SequenceUpdate);
  const seq = getDb().update(schema.sequences).set(input).where(eq(schema.sequences.id, id)).returning().get();
  return seq ? json(seq) : notFound("Séquence");
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const res = getDb().delete(schema.sequences).where(eq(schema.sequences.id, id)).run();
  return res.changes ? new Response(null, { status: 204 }) : notFound("Séquence");
});
