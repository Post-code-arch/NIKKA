import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { VariantCreate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  if (!db.select().from(schema.references).where(eq(schema.references.id, id)).get()) return notFound("Référence");
  const input = await parseBody(req, VariantCreate);
  const v = db.insert(schema.referenceVariants).values({ referenceId: id, name: input.name, views: input.views ?? [] }).returning().get();
  return json(v, { status: 201 });
});
