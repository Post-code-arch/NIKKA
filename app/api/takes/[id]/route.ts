import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound } from "@/lib/api/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const take = getDb().select().from(schema.takes).where(eq(schema.takes.id, id)).get();
  return take ? json(take) : notFound("Prise");
});
