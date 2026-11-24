import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { DEFAULT_CAMERA, type CameraAttrs } from "@/lib/camera/types";
import { cameraPhrase, supportsMovement, type CameraStage } from "@/lib/camera/phrasing";
import { availableModels, getModel, toModelInfo, type ModelInfo } from "@/lib/models/registry";
import { selectReferenceViews, type Selection } from "@/lib/refs/select";
import { buildPrompt, type PromptPart } from "./build";

export interface StagePrompt {
  modelId: string | null;
  prompt: string;
  parts: PromptPart[];
}

export interface MovementCheck {
  movement: CameraAttrs["movement"];
  supported: boolean;
  /** Available video models that handle this movement (when unsupported). */
  alternatives: Pick<ModelInfo, "id" | "label">[];
}

export interface ShotPromptPreview {
  keyframe: StagePrompt;
  video: StagePrompt;
  /** Views sent to the keyframe model, when it takes reference images. */
  references: (Selection & { maxSlots: number }) | null;
  movement: MovementCheck;
}

/**
 * Assembles the prompts of a shot for its keyframe and its animation, with
 * the camera wording of the chosen models. Used by the inspector preview and
 * as the default prompt when launching a generation.
 */
export function shotPromptPreview(
  shotId: string,
  models: { keyframe?: string | null; video?: string | null } = {},
): ShotPromptPreview | null {
  const db = getDb();
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get();
  if (!shot) return null;
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;

  const refs = shot.refIds.length
    ? db.select().from(schema.references).where(inArray(schema.references.id, shot.refIds)).all()
    : [];
  // Keep the shot's order of references.
  refs.sort((a, b) => shot.refIds.indexOf(a.id) - shot.refIds.indexOf(b.id));
  const entities = refs.filter((r) => r.tag !== "look");
  const looks = refs.filter((r) => r.tag === "look");

  const stage = (kind: CameraStage, modelId: string | null | undefined): StagePrompt => {
    const model = modelId ? getModel(modelId) : undefined;
    const { prompt, parts } = buildPrompt({
      descriptors: entities.map((r) => ({ name: r.name, descriptor: r.descriptor })),
      action: shot.description.value,
      camera: cameraPhrase(kind, camera, model?.camera),
      looks: looks.map((r) => ({ name: r.name, descriptor: r.descriptor })),
    });
    return { modelId: model?.id ?? null, prompt, parts };
  };

  const keyframeModel = models.keyframe ? getModel(models.keyframe) : undefined;
  let references: ShotPromptPreview["references"] = null;
  if (keyframeModel?.maxReferenceImages && refs.length) {
    const variants = db
      .select()
      .from(schema.referenceVariants)
      .where(inArray(schema.referenceVariants.referenceId, refs.map((r) => r.id)))
      .all();
    const selection = selectReferenceViews(
      refs.map((r) => ({
        id: r.id,
        name: r.name,
        tag: r.tag,
        views: variants.find((v) => v.referenceId === r.id)?.views ?? [],
      })),
      camera,
      keyframeModel.maxReferenceImages,
    );
    references = { ...selection, maxSlots: keyframeModel.maxReferenceImages };
  }

  const videoModel = models.video ? getModel(models.video) : undefined;
  const supported = supportsMovement(videoModel?.camera, camera.movement);
  const alternatives = supported
    ? []
    : availableModels("i2v")
        .filter((m) => m.id !== videoModel?.id && supportsMovement(m.camera, camera.movement))
        .map((m) => {
          const { id, label } = toModelInfo(m);
          return { id, label };
        });

  return {
    keyframe: stage("keyframe", models.keyframe),
    video: stage("video", models.video),
    references,
    movement: { movement: camera.movement, supported, alternatives },
  };
}
