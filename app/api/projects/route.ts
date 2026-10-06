import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, parseBody } from "@/lib/api/http";
import { ProjectCreate } from "@/lib/api/inputs";
import { DEFAULT_CONFIRM_THRESHOLD_USD } from "@/lib/cost/estimate";

export const GET = handle(async () => {
  const list = getDb()
    .select({ id: schema.projects.id, name: schema.projects.name, updatedAt: schema.projects.updatedAt })
    .from(schema.projects)
    .orderBy(desc(schema.projects.updatedAt))
    .all();
  return json(list);
});

export const POST = handle(async (req: Request) => {
  const { name } = await parseBody(req, ProjectCreate);
  const project = getDb()
    .insert(schema.projects)
    .values({ name, settings: { defaultModels: {}, confirmThresholdUsd: DEFAULT_CONFIRM_THRESHOLD_USD } })
    .returning()
    .get();
  return json(project, { status: 201 });
});
