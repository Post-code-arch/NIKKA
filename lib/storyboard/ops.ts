import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shot, Take } from "@/db/schema";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd, round } from "@/lib/cost/estimate";
import { userField } from "@/lib/domain/field";
import { GenerationError, createTake } from "@/lib/generation/service";
import { availableModels, getModel } from "@/lib/models/registry";
import type { ModelEntry } from "@/lib/models/types";
import { shotPromptPreview } from "@/lib/prompt/shot";

/** Storyboard editing (PRD §10): move, insert, split; staged batch generation. */

function shotsOf(sequenceId: string) {
  return getDb().select().from(schema.shots).where(eq(schema.shots.sequenceId, sequenceId)).orderBy(asc(schema.shots.order)).all();
}

function renumber(ids: string[]) {
  const db = getDb();
  ids.forEach((id, order) => db.update(schema.shots).set({ order }).where(eq(schema.shots.id, id)).run());
}

function loadShot(id: string): Shot {
  const shot = getDb().select().from(schema.shots).where(eq(schema.shots.id, id)).get();
  if (!shot) throw new GenerationError("Plan introuvable", 404);
  return shot;
}

function sequenceProject(sequenceId: string) {
  const seq = getDb().select().from(schema.sequences).where(eq(schema.sequences.id, sequenceId)).get();
  if (!seq) throw new GenerationError("Séquence introuvable", 404);
  return seq.projectId;
}

/** Moves a shot to `index` in a sequence of the same project (possibly another one). */
export function moveShot(shotId: string, sequenceId: string, index: number) {
  const db = getDb();
  const shot = loadShot(shotId);
  if (sequenceProject(sequenceId) !== sequenceProject(shot.sequenceId)) throw new GenerationError("Séquence d'un autre projet", 400);
  db.transaction(() => {
    if (shot.sequenceId !== sequenceId) {
      db.update(schema.shots).set({ sequenceId }).where(eq(schema.shots.id, shotId)).run();
      renumber(shotsOf(shot.sequenceId).map((s) => s.id));
    }
    const ids = shotsOf(sequenceId).map((s) => s.id).filter((id) => id !== shotId);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, shotId);
    renumber(ids);
  });
}

/** Inserts an empty shot at `index` (end when omitted). */
export function insertShot(sequenceId: string, input: { index?: number; description?: string; durationSec?: number }) {
  const db = getDb();
  sequenceProject(sequenceId);
  return db.transaction(() => {
    const ids = shotsOf(sequenceId).map((s) => s.id);
    const description = input.description ?? "";
    const shot = db
      .insert(schema.shots)
      .values({
        sequenceId,
        order: ids.length,
        description: userField(description),
        durationSec: input.durationSec ?? 3,
        camera: userField(DEFAULT_CAMERA),
        status: description ? "to_generate" : "to_write",
      })
      .returning()
      .get();
    ids.splice(Math.max(0, Math.min(input.index ?? ids.length, ids.length)), 0, shot.id);
    renumber(ids);
    return shot;
  });
}

/**
 * Cuts a shot in two: the second half follows it, with the same camera,
 * references and action; durations are split. Takes stay on the first half.
 */
export function splitShot(shotId: string) {
  const db = getDb();
  const shot = loadShot(shotId);
  if (shot.durationSec < 1) throw new GenerationError("Plan trop court pour être coupé", 400);
  const first = round(shot.durationSec / 2);
  return db.transaction(() => {
    db.update(schema.shots).set({ durationSec: first }).where(eq(schema.shots.id, shotId)).run();
    const ids = shotsOf(shot.sequenceId).map((s) => s.id);
    const second = db
      .insert(schema.shots)
      .values({
        sequenceId: shot.sequenceId,
        order: ids.length,
        description: { value: shot.description.value, origin: "validated" },
        dialogue: shot.dialogue,
        sound: shot.sound,
        durationSec: round(shot.durationSec - first),
        camera: shot.camera,
        recipeId: shot.recipeId,
        refIds: shot.refIds,
        framing: shot.framing,
        status: shot.description.value.trim() ? "to_generate" : "to_write",
      })
      .returning()
      .get();
    ids.splice(ids.indexOf(shotId) + 1, 0, second.id);
    renumber(ids);
    return second;
  });
}

// --- staged batch generation ------------------------------------------------------------

export type BatchStage = "sketch" | "keyframe" | "video";

/** Imposed style of the sketch pass: judge the breakdown cheaply. */
export const SKETCH_STYLE = "rough pencil storyboard sketch, black and white, loose lines, no color";

export interface BatchItem {
  shotId: string;
  modelId?: string;
  prompt?: string;
  parentTakeId?: string;
  durationSec?: number;
  costEstimatedUsd: number;
  /** Why this shot is left out (no keyframe to animate, no action…). */
  skipped?: string;
}

export interface BatchPlan {
  stage: BatchStage;
  items: BatchItem[];
  totalUsd: number;
  count: number;
  thresholdUsd: number;
  /** A batch always needs an explicit confirmation of the total (PRD §11). */
  needsConfirmation: boolean;
}

function pickModel(kinds: ModelEntry["kind"][], preferred?: string, tier?: ModelEntry["tier"]): ModelEntry | undefined {
  const list = availableModels().filter((m) => kinds.includes(m.kind));
  const chosen = preferred ? getModel(preferred) : undefined;
  if (chosen && kinds.includes(chosen.kind) && (!tier || chosen.tier === tier)) return chosen;
  return (tier && list.find((m) => m.tier === tier)) || list[0];
}

/** The keyframe a video starts from: the retained image take, else the latest completed one. */
export function keyframeFor(shot: Shot, takes: Take[]): Take | undefined {
  // Sketches judge the breakdown; only keyframes are animated (PRD §10).
  const images = takes.filter((t) => t.status === "completed" && t.assetId && t.stage === "keyframe");
  return images.find((t) => t.id === shot.selectedTakeId) ?? images[0];
}

export function planBatch(shotIds: string[], stage: BatchStage): BatchPlan {
  const db = getDb();
  if (shotIds.length === 0) throw new GenerationError("Aucun plan sélectionné", 400);
  const shots = db.select().from(schema.shots).where(inArray(schema.shots.id, shotIds)).all();
  const projects = new Set(shots.map((s) => sequenceProject(s.sequenceId)));
  if (projects.size !== 1) throw new GenerationError("Les plans doivent appartenir au même projet", 400);
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, [...projects][0])).get()!;
  const defaults = project.settings.defaultModels;
  const takes = db.select().from(schema.takes).where(inArray(schema.takes.shotId, shotIds)).orderBy(desc(schema.takes.createdAt)).all();

  const items: BatchItem[] = shotIds.flatMap((id): BatchItem[] => {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return [];
    if (!shot.description.value.trim()) return [{ shotId: id, costEstimatedUsd: 0, skipped: "action du plan vide" }];
    let model: ModelEntry | undefined;
    let parentTakeId: string | undefined;
    if (stage === "sketch") model = pickModel(["t2i"], defaults.sketch, "sketch");
    else if (stage === "keyframe") {
      model = pickModel(["t2i", "i2i"], defaults.keyframe);
      // A multi-reference model needs views; fall back to text → image for shots without.
      const preview = model?.kind === "i2i" ? shotPromptPreview(id, { keyframe: model.id }) : null;
      if (model?.kind === "i2i" && !preview?.references?.picked.length) model = pickModel(["t2i"]);
    } else {
      model = pickModel(["i2v"], defaults.video);
      const kf = keyframeFor(shot, takes.filter((t) => t.shotId === id));
      if (!kf) return [{ shotId: id, costEstimatedUsd: 0, skipped: "pas d'image clé terminée à animer (un crayonné ne s'anime pas)" }];
      parentTakeId = kf.id;
    }
    if (!model) return [{ shotId: id, costEstimatedUsd: 0, skipped: "aucun modèle disponible" }];
    const preview = shotPromptPreview(id, stage === "video" ? { video: model.id } : { keyframe: model.id });
    const base = (stage === "video" ? preview?.video.prompt : preview?.keyframe.prompt) || shot.description.value;
    return [
      {
        shotId: id,
        modelId: model.id,
        prompt: stage === "sketch" ? `${base} ${SKETCH_STYLE}.` : base,
        parentTakeId,
        durationSec: stage === "video" ? shot.durationSec : undefined,
        costEstimatedUsd: estimateCostUsd(model, { seconds: shot.durationSec }),
      },
    ];
  });
  const go = items.filter((i) => !i.skipped);
  const totalUsd = round(go.reduce((n, i) => n + i.costEstimatedUsd, 0));
  const thresholdUsd = project.settings.confirmThresholdUsd ?? DEFAULT_CONFIRM_THRESHOLD_USD;
  return { stage, items, totalUsd, count: go.length, thresholdUsd, needsConfirmation: go.length > 1 || totalUsd > thresholdUsd };
}

/** Launches a confirmed batch: one new take per shot, never retried. */
export async function launchBatch(shotIds: string[], stage: BatchStage, confirmedTotalUsd?: number) {
  const plan = planBatch(shotIds, stage);
  if (plan.count === 0) throw new GenerationError("Aucun plan à générer dans la sélection", 400);
  if (plan.needsConfirmation && (confirmedTotalUsd ?? -1) < plan.totalUsd) {
    throw new GenerationError("Confirmation du coût total requise", 409, { ...plan });
  }
  const results: { shotId: string; takeId?: string; error?: string }[] = [];
  for (const item of plan.items) {
    if (item.skipped) continue;
    try {
      const take = await createTake({
        shotId: item.shotId,
        modelId: item.modelId!,
        stage,
        prompt: item.prompt!,
        parentTakeId: item.parentTakeId,
        // The shot's duration goes to the model (it was missing: the model used its default).
        durationSec: item.durationSec,
        confirmedCostUsd: item.costEstimatedUsd,
      });
      results.push({ shotId: item.shotId, takeId: take.id });
    } catch (e) {
      results.push({ shotId: item.shotId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { plan, results };
}

export function sequenceShotIds(sequenceId: string) {
  return getDb()
    .select({ id: schema.shots.id })
    .from(schema.shots)
    .where(and(eq(schema.shots.sequenceId, sequenceId)))
    .orderBy(asc(schema.shots.order))
    .all()
    .map((s) => s.id);
}
