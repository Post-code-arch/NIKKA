import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { SequenceCreate } from "@/lib/api/inputs";
import { userField } from "@/lib/domain/field";
import { nextSequenceOrder } from "@/lib/projects/queries";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  if (!db.select().from(schema.projects).where(eq(schema.projects.id, id)).get()) return notFound("Projet");
  const input = await parseBody(req, SequenceCreate);
  const order = nextSequenceOrder(id);
  const seq = db
    .insert(schema.sequences)
    .values({
      projectId: id,
      order,
      title: userField(input.title ?? `Séquence ${order + 1}`),
      summary: userField(input.summary ?? ""),
    })
    .returning()
    .get();
  db.update(schema.projects).set({ updatedAt: Date.now() }).where(eq(schema.projects.id, id)).run();
  return json(seq, { status: 201 });
});
