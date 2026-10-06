import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json, notFound, parseBody } from "@/lib/api/http";
import { ProjectUpdate } from "@/lib/api/inputs";
import { getProjectTree } from "@/lib/projects/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const tree = getProjectTree((await params).id);
  return tree ? json(tree) : notFound("Projet");
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const db = getDb();
  const current = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
  if (!current) return notFound("Projet");
  const input = await parseBody(req, ProjectUpdate);
  const { budgetUsd, ...restSettings } = input.settings ?? {};
  const settings = input.settings
    ? {
        ...current.settings,
        ...Object.fromEntries(Object.entries(restSettings).filter(([, v]) => v !== undefined)),
        ...(budgetUsd === null ? { budgetUsd: undefined } : budgetUsd !== undefined ? { budgetUsd } : {}),
      }
    : current.settings;
  const updated = db
    .update(schema.projects)
    .set({ name: input.name ?? current.name, briefRaw: input.briefRaw ?? current.briefRaw, settings, updatedAt: Date.now() })
    .where(eq(schema.projects.id, id))
    .returning()
    .get();
  return json(updated);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const res = getDb().delete(schema.projects).where(eq(schema.projects.id, id)).run();
  return res.changes ? new Response(null, { status: 204 }) : notFound("Projet");
});
