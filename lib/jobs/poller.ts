import { and, eq, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Job } from "@/db/schema";
import {
  downloadToAssets,
  getPrediction,
  predictionError,
  predictionOutputs,
  predictionState,
} from "@/lib/atlas";
import { probeMedia } from "@/lib/media/probe";

/**
 * Server-side job poller (PRD §3). Follows active predictions, downloads
 * outputs to storage/assets as soon as they complete, records assets and
 * costs on the take. Never resubmits anything.
 */

const TICK_MS = 1000;
const BASE_INTERVAL_MS = 3000;
const MAX_INTERVAL_MS = 10_000;
const TIMEOUT_MS = Number(process.env.NIKKA_JOB_TIMEOUT_MS ?? 30 * 60_000);

const g = globalThis as unknown as { __nikkaPoller?: { timer: NodeJS.Timeout; busy: boolean } };

export function ensurePoller(): void {
  if (g.__nikkaPoller) return;
  const state = { busy: false, timer: setInterval(() => void tick(), TICK_MS) };
  state.timer.unref?.();
  g.__nikkaPoller = state;
}

export function stopPoller(): void {
  if (g.__nikkaPoller) clearInterval(g.__nikkaPoller.timer);
  g.__nikkaPoller = undefined;
}

function nextInterval(attempts: number, mock: boolean): number {
  const base = mock ? 500 : BASE_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.round(base * 1.3 ** attempts));
}

async function tick(): Promise<void> {
  const state = g.__nikkaPoller;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    await pollDueJobs();
  } finally {
    state.busy = false;
  }
}

/** Polls every active job that is due. Exported for tests and scripts. */
export async function pollDueJobs(now = Date.now()): Promise<void> {
  const db = getDb();
  const due = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.status, "active"), lte(schema.jobs.nextPollAt, now)))
    .all();
  for (const job of due) {
    try {
      await pollJob(job);
    } catch (err) {
      // Transient (network...) — keep the job active and back off.
      const attempts = job.attempts + 1;
      db.update(schema.jobs)
        .set({
          attempts,
          lastPolledAt: Date.now(),
          nextPollAt: Date.now() + nextInterval(attempts, false),
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(schema.jobs.id, job.id))
        .run();
    }
  }
}

async function pollJob(job: Job): Promise<void> {
  const db = getDb();
  const mock = job.predictionId.startsWith("mock-");
  const data = await getPrediction(job.predictionId);
  const state = predictionState(data);
  const attempts = job.attempts + 1;

  if (state === "pending") {
    if (Date.now() - job.createdAt > TIMEOUT_MS) {
      return finishFailed(job, `Suivi interrompu après ${Math.round(TIMEOUT_MS / 60000)} min (prédiction ${job.predictionId} toujours en cours côté Atlas)`);
    }
    db.update(schema.takes)
      .set({ status: "processing" })
      .where(and(eq(schema.takes.id, job.takeId), eq(schema.takes.status, "queued")))
      .run();
    db.update(schema.jobs)
      .set({ attempts, lastPolledAt: Date.now(), nextPollAt: Date.now() + nextInterval(attempts, mock), error: null })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return;
  }

  if (state === "failed") return finishFailed(job, predictionError(data));

  const urls = predictionOutputs(data);
  if (urls.length === 0) return finishFailed(job, "Prédiction terminée sans sortie");

  // Download everything first: Atlas URLs are temporary.
  const files = [];
  for (const url of urls) files.push(await downloadToAssets(url));

  const take = db.select().from(schema.takes).where(eq(schema.takes.id, job.takeId)).get();
  if (!take) return;

  const assetIds: string[] = [];
  for (const f of files) {
    if (f.kind === "other") continue;
    const info = await probeMedia(f.absolutePath);
    const asset = db
      .insert(schema.assets)
      .values({
        kind: f.kind,
        path: f.path,
        sha256: f.sha256,
        width: info.width,
        height: info.height,
        durationSec: f.kind === "video" ? info.durationSec : undefined,
      })
      .returning()
      .get();
    assetIds.push(asset.id);
  }
  if (assetIds.length === 0) return finishFailed(job, "Aucun média image/vidéo dans la sortie");

  db.transaction((tx) => {
    // V1: actual cost = estimate (PRD §11).
    tx.update(schema.takes)
      .set({ status: "completed", assetId: assetIds[0], costActualUsd: take.costEstimatedUsd, error: null })
      .where(eq(schema.takes.id, take.id))
      .run();
    // Extra outputs become sibling takes so nothing is lost.
    for (const assetId of assetIds.slice(1)) {
      tx.insert(schema.takes)
        .values({
          shotId: take.shotId,
          stage: take.stage,
          parentTakeId: take.parentTakeId,
          model: take.model,
          prompt: take.prompt,
          params: take.params,
          seed: take.seed,
          predictionId: take.predictionId,
          status: "completed",
          assetId,
          costEstimatedUsd: 0,
          costActualUsd: 0,
        })
        .run();
    }
    tx.update(schema.jobs)
      .set({ status: "completed", attempts, lastPolledAt: Date.now(), error: null })
      .where(eq(schema.jobs.id, job.id))
      .run();
  });
  refreshShotStatus(take.shotId);
}

function finishFailed(job: Job, error: string) {
  const db = getDb();
  db.update(schema.takes).set({ status: "failed", error }).where(eq(schema.takes.id, job.takeId)).run();
  db.update(schema.jobs)
    .set({ status: "failed", error, lastPolledAt: Date.now(), attempts: job.attempts + 1 })
    .where(eq(schema.jobs.id, job.id))
    .run();
  const take = db.select().from(schema.takes).where(eq(schema.takes.id, job.takeId)).get();
  if (take) refreshShotStatus(take.shotId);
}

/** generating while a take is in flight, else to_review if any completed take exists. */
export function refreshShotStatus(shotId: string) {
  const db = getDb();
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get();
  if (!shot || shot.status === "approved") return;
  const list = db.select().from(schema.takes).where(eq(schema.takes.shotId, shotId)).all();
  const inFlight = list.some((t) => t.status === "queued" || t.status === "processing");
  const done = list.some((t) => t.status === "completed");
  const status = inFlight ? "generating" : done ? "to_review" : "to_generate";
  db.update(schema.shots).set({ status }).where(eq(schema.shots.id, shotId)).run();
}

export function activeJobTakeIds(): string[] {
  return getDb()
    .select({ takeId: schema.jobs.takeId })
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["active"]))
    .all()
    .map((r) => r.takeId);
}
