import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ReferenceUpdate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

/** Reference with its variants, pack candidates and the media they use. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  const ref = db.select().from(schema.references).where(eq(schema.references.id, id)).get();
  if (!ref) return notFound("Référence");
  const variants = db.select().from(schema.referenceVariants).where(eq(schema.referenceVariants.referenceId, id)).all();
  const generations = db
    .select()
    .from(schema.refGenerations)
    .where(eq(schema.refGenerations.referenceId, id))
    .orderBy(desc(schema.refGenerations.createdAt))
    .all();
  const assetIds = new Set<string>();
  variants.forEach((v) => v.views.forEach((w) => assetIds.add(w.assetId)));
  generations.forEach((g) => g.assetId && assetIds.add(g.assetId));
  const assets = assetIds.size
    ? db
        .select({ id: schema.assets.id, kind: schema.assets.kind, width: schema.assets.width, height: schema.assets.height })
        .from(schema.assets)
        .where(inArray(schema.assets.id, [...assetIds]))
        .all()
    : [];
  return json({ ...ref, variants, generations, assets: Object.fromEntries(assets.map((a) => [a.id, a])) });
});

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
