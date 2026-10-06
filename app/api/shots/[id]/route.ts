import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ShotUpdate } from "@/lib/api/inputs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const shot = getDb().select().from(schema.shots).where(eq(schema.shots.id, id)).get();
  return shot ? json(shot) : notFound("Plan");
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  const current = db.select().from(schema.shots).where(eq(schema.shots.id, id)).get();
  if (!current) return notFound("Plan");
  const input = await parseBody(req, ShotUpdate);
  if (input.selectedTakeId) {
    const take = db.select().from(schema.takes).where(eq(schema.takes.id, input.selectedTakeId)).get();
    if (!take || take.shotId !== id) return json({ error: "Cette prise n'appartient pas au plan" }, { status: 400 });
  }
  const patch = { ...input };
  if (input.description && current.status === "to_write" && input.description.value.trim()) patch.status ??= "to_generate";
  const shot = db.update(schema.shots).set(patch).where(eq(schema.shots.id, id)).returning().get();
  return json(shot);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const res = getDb().delete(schema.shots).where(eq(schema.shots.id, id)).run();
  return res.changes ? new Response(null, { status: 204 }) : notFound("Plan");
});
