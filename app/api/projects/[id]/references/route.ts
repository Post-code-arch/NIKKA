import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ReferenceCreate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json(getDb().select().from(schema.references).where(eq(schema.references.projectId, id)).all());
});

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  if (!db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()) return notFound("Projet");
  const input = await parseBody(req, ReferenceCreate);
  // Every reference starts with one variant so images can be added right away.
  const ref = db.transaction((tx) => {
    const r = tx.insert(schema.references).values({ projectId: id, ...input }).returning().get();
    tx.insert(schema.referenceVariants).values({ referenceId: r.id, name: "Principale" }).run();
    return r;
  });
  return json(ref, { status: 201 });
});
