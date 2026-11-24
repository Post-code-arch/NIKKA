import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { RefGeneration, ReferenceTag, RefView } from "@/db/schema";
import { generateImage, uploadMedia } from "@/lib/atlas";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd, round } from "@/lib/cost/estimate";
import { GenerationError } from "@/lib/generation/service";
import { ensurePoller } from "@/lib/jobs/poller";
import { getModel } from "@/lib/models/registry";
import type { ModelEntry } from "@/lib/models/types";

/**
 * Reference-pack assistant (PRD §7): generates the standard views of a
 * reference, from a source image (multi-reference edit model) or from the
 * descriptor alone (text-to-image). Each view is a candidate the user
 * validates; nothing is overwritten.
 */

const STUDIO = "Plain neutral grey studio background, soft even lighting.";
const EXPRESSIONS = ["smiling warmly", "angry, frowning", "surprised, eyes wide"];

/** English view instructions. The descriptor is injected verbatim before them. */
export function viewInstruction(tag: ReferenceTag, view: RefView, index = 0): string {
  switch (view) {
    case "face_front":
      return `Front-facing head-and-shoulders portrait, looking straight at the camera, neutral expression. ${STUDIO}`;
    case "face_34":
      return `Three-quarter view head-and-shoulders portrait, neutral expression. ${STUDIO}`;
    case "profile":
      return `Strict side profile, head and shoulders. ${STUDIO}`;
    case "full_body":
      return `Full-body shot from head to toe, standing, front view, whole outfit visible. ${STUDIO}`;
    case "expression":
      return `Close-up portrait, ${EXPRESSIONS[index % EXPRESSIONS.length]}. ${STUDIO}`;
    case "establishing":
      return "Wide establishing shot of the location, no people, natural composition.";
    case "angle_a":
      return "The same location seen from the opposite angle, no people.";
    case "angle_b":
      return "Closer angle on a characteristic part of the same location, no people.";
    case "detail":
      return tag === "object"
        ? `Detailed close-up of the object, sharp focus. ${index % 2 ? "Three-quarter angle." : "Front view."} ${STUDIO}`
        : "Detailed close-up of a characteristic element, sharp focus.";
    case "mood":
      return "Mood frame conveying this look: lighting, atmosphere and color grading, cinematic still.";
    case "palette":
      return "Color palette study of this look: abstract swatches of its dominant colors.";
    case "untagged":
      return "Reference image.";
  }
}

export function buildPackPrompt(descriptor: string, tag: ReferenceTag, view: RefView, index: number, withSource: boolean) {
  const keep = withSource ? "Keep exactly the same identity and design as in the reference image." : "";
  return [descriptor.trim(), viewInstruction(tag, view, index), keep].filter(Boolean).join(" ");
}

function loadContext(referenceId: string, variantId: string) {
  const db = getDb();
  const ref = db.select().from(schema.references).where(eq(schema.references.id, referenceId)).get();
  if (!ref) throw new GenerationError("Référence introuvable", 404);
  const variant = db
    .select()
    .from(schema.referenceVariants)
    .where(and(eq(schema.referenceVariants.id, variantId), eq(schema.referenceVariants.referenceId, referenceId)))
    .get();
  if (!variant) throw new GenerationError("Variante introuvable", 404);
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, ref.projectId)).get();
  return { ref, variant, threshold: project?.settings.confirmThresholdUsd ?? DEFAULT_CONFIRM_THRESHOLD_USD };
}

function checkModel(modelId: string, withSource: boolean): ModelEntry {
  const model = getModel(modelId);
  if (!model) throw new GenerationError(`Modèle inconnu : ${modelId}`, 400);
  if (withSource && (model.kind !== "i2i" || !model.maxReferenceImages)) {
    throw new GenerationError("Avec une image source, il faut un modèle d'édition multi-références", 400);
  }
  if (!withSource && model.kind !== "t2i") {
    throw new GenerationError("Sans image source, il faut un modèle texte → image", 400);
  }
  return model;
}

export interface PackInput {
  referenceId: string;
  variantId: string;
  views: RefView[];
  modelId: string;
  sourceAssetId?: string;
  confirmedCostUsd?: number;
}

export function estimatePack(input: Omit<PackInput, "confirmedCostUsd">) {
  const { threshold } = loadContext(input.referenceId, input.variantId);
  const model = checkModel(input.modelId, !!input.sourceAssetId);
  const cost = round(estimateCostUsd(model) * input.views.length);
  return { modelId: model.id, views: input.views.length, costEstimatedUsd: cost, thresholdUsd: threshold, needsConfirmation: cost > threshold };
}

/** Launches one generation per requested view. Never retried on failure. */
export async function launchPack(input: PackInput): Promise<RefGeneration[]> {
  if (input.views.length === 0) throw new GenerationError("Aucune vue demandée", 400);
  const db = getDb();
  const { ref, variant } = loadContext(input.referenceId, input.variantId);
  const model = checkModel(input.modelId, !!input.sourceAssetId);
  const estimate = estimatePack(input);
  if (estimate.needsConfirmation && (input.confirmedCostUsd ?? -1) < estimate.costEstimatedUsd) {
    throw new GenerationError("Confirmation du coût requise", 409, { ...estimate });
  }
  if (!ref.descriptor.trim() && !input.sourceAssetId) {
    throw new GenerationError("Sans image source, écris d'abord le descripteur de la référence", 400);
  }

  // The local file is the source of truth: upload it once for a fresh temporary URL.
  let sourceUrl: string | undefined;
  if (input.sourceAssetId) {
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, input.sourceAssetId)).get();
    if (!asset || asset.kind !== "image") throw new GenerationError("Image source introuvable", 400);
    sourceUrl = await uploadMedia(path.resolve(asset.path));
  }

  const unitCost = estimateCostUsd(model);
  // Continue numbering per view so a new expression is not the same as the last one.
  const seen = new Map<RefView, number>();
  for (const g of db.select().from(schema.refGenerations).where(eq(schema.refGenerations.variantId, variant.id)).all()) {
    seen.set(g.view, (seen.get(g.view) ?? 0) + 1);
  }
  const created: RefGeneration[] = [];
  for (const view of input.views) {
    const index = seen.get(view) ?? 0;
    seen.set(view, index + 1);
    const prompt = buildPackPrompt(ref.descriptor, ref.tag, view, index, !!sourceUrl);
    const body = { model: model.id, ...model.mapInputs({ prompt, referenceImageUrls: sourceUrl ? [sourceUrl] : undefined }) };
    const gen = db
      .insert(schema.refGenerations)
      .values({
        referenceId: ref.id,
        variantId: variant.id,
        view,
        sourceAssetId: input.sourceAssetId,
        model: model.id,
        prompt,
        params: body,
        status: "queued",
        costEstimatedUsd: unitCost,
      })
      .returning()
      .get();
    try {
      const sub = await generateImage(body);
      db.update(schema.refGenerations).set({ predictionId: sub.predictionId }).where(eq(schema.refGenerations.id, gen.id)).run();
      db.insert(schema.jobs).values({ refGenerationId: gen.id, predictionId: sub.predictionId, endpoint: sub.endpoint }).run();
    } catch (err) {
      db.update(schema.refGenerations)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(schema.refGenerations.id, gen.id))
        .run();
    }
    created.push(db.select().from(schema.refGenerations).where(eq(schema.refGenerations.id, gen.id)).get()!);
  }
  ensurePoller();
  return created;
}

/** One more candidate for the same view (the previous ones are kept). */
export async function regenerateView(generationId: string, confirmedCostUsd?: number) {
  const gen = getDb().select().from(schema.refGenerations).where(eq(schema.refGenerations.id, generationId)).get();
  if (!gen) throw new GenerationError("Génération introuvable", 404);
  const [created] = await launchPack({
    referenceId: gen.referenceId,
    variantId: gen.variantId,
    views: [gen.view],
    modelId: gen.model,
    sourceAssetId: gen.sourceAssetId ?? undefined,
    confirmedCostUsd,
  });
  return created;
}

/** Adds a completed candidate to its variant's views. */
export function validateGeneration(generationId: string) {
  const db = getDb();
  const gen = db.select().from(schema.refGenerations).where(eq(schema.refGenerations.id, generationId)).get();
  if (!gen) throw new GenerationError("Génération introuvable", 404);
  if (gen.status !== "completed" || !gen.assetId) throw new GenerationError("Cette vue n'est pas encore prête", 400);
  const variant = db.select().from(schema.referenceVariants).where(eq(schema.referenceVariants.id, gen.variantId)).get();
  if (!variant) throw new GenerationError("Variante introuvable", 404);
  const views = variant.views.some((v) => v.assetId === gen.assetId)
    ? variant.views
    : [...variant.views, { assetId: gen.assetId, view: gen.view }];
  db.transaction((tx) => {
    tx.update(schema.referenceVariants).set({ views }).where(eq(schema.referenceVariants.id, variant.id)).run();
    tx.update(schema.refGenerations).set({ validated: true }).where(eq(schema.refGenerations.id, gen.id)).run();
    tx.update(schema.references).set({ updatedAt: Date.now() }).where(eq(schema.references.id, gen.referenceId)).run();
  });
  return { ...gen, validated: true };
}
