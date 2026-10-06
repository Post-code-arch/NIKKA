import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { handle, json } from "@/lib/api/http";
import { ensurePoller } from "@/lib/jobs/poller";

/**
 * Job states for the client. `?projectId=` limits to one project,
 * `?active=1` to jobs still being followed.
 */
export const GET = handle(async (req: Request) => {
  ensurePoller();
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const activeOnly = url.searchParams.get("active") === "1";
  const db = getDb();

  let takeIds: string[] | null = null;
  if (projectId) {
    const seqIds = db.select({ id: schema.sequences.id }).from(schema.sequences).where(eq(schema.sequences.projectId, projectId)).all().map((r) => r.id);
    const shotIds = seqIds.length
      ? db.select({ id: schema.shots.id }).from(schema.shots).where(inArray(schema.shots.sequenceId, seqIds)).all().map((r) => r.id)
      : [];
    takeIds = shotIds.length
      ? db.select({ id: schema.takes.id }).from(schema.takes).where(inArray(schema.takes.shotId, shotIds)).all().map((r) => r.id)
      : [];
    if (takeIds.length === 0) return json([]);
  }

  const rows = db
    .select({
      id: schema.jobs.id,
      takeId: schema.jobs.takeId,
      status: schema.jobs.status,
      endpoint: schema.jobs.endpoint,
      attempts: schema.jobs.attempts,
      lastPolledAt: schema.jobs.lastPolledAt,
      error: schema.jobs.error,
      createdAt: schema.jobs.createdAt,
      takeStatus: schema.takes.status,
      shotId: schema.takes.shotId,
    })
    .from(schema.jobs)
    .innerJoin(schema.takes, eq(schema.takes.id, schema.jobs.takeId))
    .where(takeIds ? inArray(schema.jobs.takeId, takeIds) : undefined)
    .orderBy(desc(schema.jobs.createdAt))
    .limit(200)
    .all();
  return json(activeOnly ? rows.filter((r) => r.status === "active") : rows);
});
