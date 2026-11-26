import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ShotCreate } from "@/lib/api/inputs";
import { insertShot } from "@/lib/storyboard/ops";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  if (!db.select().from(schema.sequences).where(eq(schema.sequences.id, id)).get()) return notFound("Séquence");
  const input = await parseBody(req, ShotCreate);
  // At the end, or between two shots with `index`.
  return json(insertShot(id, input), { status: 201 });
});
