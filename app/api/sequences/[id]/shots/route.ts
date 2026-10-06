import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ShotCreate } from "@/lib/api/inputs";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { userField } from "@/lib/domain/field";
import { nextShotOrder } from "@/lib/projects/queries";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  if (!db.select().from(schema.sequences).where(eq(schema.sequences.id, id)).get()) return notFound("Séquence");
  const input = await parseBody(req, ShotCreate);
  const description = input.description ?? "";
  const shot = db
    .insert(schema.shots)
    .values({
      sequenceId: id,
      order: nextShotOrder(id),
      description: userField(description),
      durationSec: input.durationSec ?? 3,
      camera: userField(DEFAULT_CAMERA),
      status: description ? "to_generate" : "to_write",
    })
    .returning()
    .get();
  return json(shot, { status: 201 });
});
