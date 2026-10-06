import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Take, TakeStage } from "@/db/schema";
import { generateImage, generateVideo, uploadMedia } from "@/lib/atlas";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd } from "@/lib/cost/estimate";
import { ensurePoller } from "@/lib/jobs/poller";
import { getModel } from "@/lib/models/registry";
import type { GenericInputs } from "@/lib/models/types";

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface CreateTakeInput {
  shotId: string;
  modelId: string;
  stage: TakeStage;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  durationSec?: number;
  /** For video: the keyframe take used as start image. */
  parentTakeId?: string;
  /** Set once the user saw the estimate and confirmed it. */
  confirmedCostUsd?: number;
}

export interface EstimateResult {
  modelId: string;
  costEstimatedUsd: number;
  thresholdUsd: number;
  needsConfirmation: boolean;
}

function threshold(projectSettings: { confirmThresholdUsd?: number } | undefined) {
  return projectSettings?.confirmThresholdUsd ?? DEFAULT_CONFIRM_THRESHOLD_USD;
}

function loadShotContext(shotId: string) {
  const db = getDb();
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get();
  if (!shot) throw new GenerationError("Plan introuvable", 404);
  const sequence = db.select().from(schema.sequences).where(eq(schema.sequences.id, shot.sequenceId)).get();
  const project = sequence
    ? db.select().from(schema.projects).where(eq(schema.projects.id, sequence.projectId)).get()
    : undefined;
  return { shot, project };
}

export function estimateTake(input: Pick<CreateTakeInput, "shotId" | "modelId" | "durationSec">): EstimateResult {
  const model = getModel(input.modelId);
  if (!model) throw new GenerationError(`Modèle inconnu : ${input.modelId}`, 400);
  const { shot, project } = loadShotContext(input.shotId);
  const seconds = input.durationSec ?? shot.durationSec;
  const cost = estimateCostUsd(model, { seconds });
  const t = threshold(project?.settings);
  return { modelId: model.id, costEstimatedUsd: cost, thresholdUsd: t, needsConfirmation: cost > t };
}

/**
 * Submits one generation and records it as a NEW take (takes are never
 * overwritten). Paid calls are never retried: a submission error marks the
 * take failed.
 */
export async function createTake(input: CreateTakeInput): Promise<Take> {
  const db = getDb();
  const model = getModel(input.modelId);
  if (!model) throw new GenerationError(`Modèle inconnu : ${input.modelId}`, 400);
  const estimate = estimateTake(input);
  if (estimate.needsConfirmation && (input.confirmedCostUsd ?? -1) < estimate.costEstimatedUsd) {
    throw new GenerationError("Confirmation du coût requise", 409, { ...estimate });
  }

  const generic: GenericInputs = {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    seed: model.supportsSeed ? input.seed : undefined,
    durationSec: input.durationSec,
  };

  if (model.kind === "i2v") {
    if (!input.parentTakeId) throw new GenerationError("Une image de départ (prise parente) est requise", 400);
    const parent = db.select().from(schema.takes).where(eq(schema.takes.id, input.parentTakeId)).get();
    const asset = parent?.assetId
      ? db.select().from(schema.assets).where(eq(schema.assets.id, parent.assetId)).get()
      : undefined;
    if (!asset || asset.kind !== "image") throw new GenerationError("La prise parente n'a pas d'image", 400);
    // The local file is the source of truth: re-upload it for a fresh temporary URL.
    generic.startImageUrl = await uploadMedia(path.resolve(asset.path));
  }

  const body = { model: model.id, ...model.mapInputs(generic) };
  const take = db
    .insert(schema.takes)
    .values({
      shotId: input.shotId,
      stage: input.stage,
      parentTakeId: input.parentTakeId,
      model: model.id,
      prompt: input.prompt,
      params: body,
      seed: generic.seed,
      status: "queued",
      costEstimatedUsd: estimate.costEstimatedUsd,
    })
    .returning()
    .get();

  try {
    const submitted = model.endpoint === "generateImage" ? await generateImage(body) : await generateVideo(body);
    db.update(schema.takes).set({ predictionId: submitted.predictionId }).where(eq(schema.takes.id, take.id)).run();
    db.insert(schema.jobs)
      .values({ takeId: take.id, predictionId: submitted.predictionId, endpoint: submitted.endpoint })
      .run();
    db.update(schema.shots).set({ status: "generating" }).where(eq(schema.shots.id, input.shotId)).run();
    ensurePoller();
  } catch (err) {
    db.update(schema.takes)
      .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .where(eq(schema.takes.id, take.id))
      .run();
  }
  return db.select().from(schema.takes).where(eq(schema.takes.id, take.id)).get()!;
}
