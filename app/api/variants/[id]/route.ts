import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { VariantUpdate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(req, VariantUpdate);
  const v = getDb().update(schema.referenceVariants).set(input).where(eq(schema.referenceVariants.id, id)).returning().get();
  return v ? json(v) : notFound("Variante");
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const res = getDb().delete(schema.referenceVariants).where(eq(schema.referenceVariants.id, id)).run();
  return res.changes ? new Response(null, { status: 204 }) : notFound("Variante");
});
