import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ReferenceUpdate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(req, ReferenceUpdate);
  const ref = getDb()
    .update(schema.references)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(schema.references.id, id))
    .returning()
    .get();
  return ref ? json(ref) : notFound("Référence");
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const res = getDb().delete(schema.references).where(eq(schema.references.id, id)).run();
  return res.changes ? new Response(null, { status: 204 }) : notFound("Référence");
});
