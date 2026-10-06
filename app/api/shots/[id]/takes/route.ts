import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, parseBody } from "@/lib/api/http";
import { TakeCreate } from "@/lib/api/inputs";
import { createTake } from "@/lib/generation/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return json(
    getDb().select().from(schema.takes).where(eq(schema.takes.shotId, id)).orderBy(desc(schema.takes.createdAt)).all(),
  );
});

/** Launches a generation: always creates a new take (never overwrites). */
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = await parseBody(req, TakeCreate);
  const take = await createTake({ shotId: id, ...input });
  return json(take, { status: 201 });
});
