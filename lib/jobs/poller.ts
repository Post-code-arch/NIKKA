import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { recordObservedPrice } from "@/lib/models/store";
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
    if (job.takeId) {
      db.update(schema.takes)
        .set({ status: "processing" })
        .where(and(eq(schema.takes.id, job.takeId), eq(schema.takes.status, "queued")))
        .run();
    }
    if (job.refGenerationId) {
      db.update(schema.refGenerations)
        .set({ status: "processing" })
        .where(and(eq(schema.refGenerations.id, job.refGenerationId), eq(schema.refGenerations.status, "queued")))
        .run();
    }
    if (job.nodeRunId) {
      db.update(schema.nodeRuns)
        .set({ status: "processing" })
        .where(and(eq(schema.nodeRuns.id, job.nodeRunId), eq(schema.nodeRuns.status, "queued")))
        .run();
    }
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

  // Atlas reports the billed price of the prediction: the real cost, when given.
  const billed = Number(data.price);
  const actualUsd = Number.isFinite(billed) && billed >= 0 && !mock ? billed : undefined;
  if (actualUsd !== undefined) learnPrice(job, actualUsd);
  if (job.takeId) completeTake(job, job.takeId, assetIds, attempts, actualUsd);
  else if (job.refGenerationId) completeRefGeneration(job, job.refGenerationId, assetIds, attempts, actualUsd);
  else if (job.nodeRunId) completeNodeRun(job, job.nodeRunId, assetIds, attempts, actualUsd);
}

/** The first real bill of a model corrects its unit price for every later estimate. */
function learnPrice(job: Job, billedUsd: number) {
  const db = getDb();
  const row = job.takeId
    ? db.select().from(schema.takes).where(eq(schema.takes.id, job.takeId)).get()
    : job.nodeRunId
      ? db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.id, job.nodeRunId)).get()
      : job.refGenerationId
        ? db.select().from(schema.refGenerations).where(eq(schema.refGenerations.id, job.refGenerationId)).get()
        : undefined;
  if (row) recordObservedPrice(row.model, row.costEstimatedUsd, billedUsd);
}

function markJobDone(tx: Pick<ReturnType<typeof getDb>, "update">, job: Job, attempts: number) {
  tx.update(schema.jobs)
    .set({ status: "completed", attempts, lastPolledAt: Date.now(), error: null })
    .where(eq(schema.jobs.id, job.id))
    .run();
}

function completeTake(job: Job, takeId: string, assetIds: string[], attempts: number, actualUsd?: number) {
  const db = getDb();
  const take = db.select().from(schema.takes).where(eq(schema.takes.id, takeId)).get();
  if (!take) return;
  db.transaction((tx) => {
    // V1: actual cost = estimate (PRD §11).
    tx.update(schema.takes)
      .set({ status: "completed", assetId: assetIds[0], costActualUsd: actualUsd ?? take.costEstimatedUsd, error: null })
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
    markJobDone(tx, job, attempts);
  });
  refreshShotStatus(take.shotId);
}

function completeRefGeneration(job: Job, genId: string, assetIds: string[], attempts: number, actualUsd?: number) {
  const db = getDb();
  const gen = db.select().from(schema.refGenerations).where(eq(schema.refGenerations.id, genId)).get();
  if (!gen) return;
  db.transaction((tx) => {
    tx.update(schema.refGenerations)
      .set({ status: "completed", assetId: assetIds[0], costActualUsd: actualUsd ?? gen.costEstimatedUsd, error: null })
      .where(eq(schema.refGenerations.id, gen.id))
      .run();
    // Extra outputs become extra candidates for the same view.
    for (const assetId of assetIds.slice(1)) {
      tx.insert(schema.refGenerations)
        .values({
          referenceId: gen.referenceId,
          variantId: gen.variantId,
          view: gen.view,
          sourceAssetId: gen.sourceAssetId,
          model: gen.model,
          prompt: gen.prompt,
          params: gen.params,
          predictionId: gen.predictionId,
          status: "completed",
          assetId,
          costEstimatedUsd: 0,
          costActualUsd: 0,
        })
        .run();
    }
    markJobDone(tx, job, attempts);
  });
}

function completeNodeRun(job: Job, runId: string, assetIds: string[], attempts: number, actualUsd?: number) {
  const db = getDb();
  const run = db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.id, runId)).get();
  if (!run) return;
  db.transaction((tx) => {
    tx.update(schema.nodeRuns)
      .set({ status: "completed", assetId: assetIds[0], costActualUsd: actualUsd ?? run.costEstimatedUsd, error: null })
      .where(eq(schema.nodeRuns.id, run.id))
      .run();
    // Extra outputs become extra results of the same node.
    for (const assetId of assetIds.slice(1)) {
      tx.insert(schema.nodeRuns)
        .values({
          projectId: run.projectId,
          nodeId: run.nodeId,
          kind: run.kind,
          model: run.model,
          prompt: run.prompt,
          params: run.params,
          seed: run.seed,
          predictionId: run.predictionId,
          status: "completed",
          assetId,
          costEstimatedUsd: 0,
          costActualUsd: 0,
        })
        .run();
    }
    markJobDone(tx, job, attempts);
  });
}

function finishFailed(job: Job, error: string) {
  const db = getDb();
  if (job.takeId) db.update(schema.takes).set({ status: "failed", error }).where(eq(schema.takes.id, job.takeId)).run();
  if (job.refGenerationId) {
    db.update(schema.refGenerations).set({ status: "failed", error }).where(eq(schema.refGenerations.id, job.refGenerationId)).run();
  }
  if (job.nodeRunId) {
    db.update(schema.nodeRuns).set({ status: "failed", error }).where(eq(schema.nodeRuns.id, job.nodeRunId)).run();
  }
  db.update(schema.jobs)
    .set({ status: "failed", error, lastPolledAt: Date.now(), attempts: job.attempts + 1 })
    .where(eq(schema.jobs.id, job.id))
    .run();
  if (job.takeId) {
    const take = db.select().from(schema.takes).where(eq(schema.takes.id, job.takeId)).get();
    if (take) refreshShotStatus(take.shotId);
  }
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
