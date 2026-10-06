import { z } from "zod";
import { CameraAttrsSchema } from "@/lib/camera/types";
import { fieldSchema } from "@/lib/domain/field";

const text = fieldSchema(z.string());

export const ProjectCreate = z.object({ name: z.string().trim().min(1).max(200) });
export const ProjectUpdate = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  briefRaw: z.string().optional(),
  settings: z
    .object({
      defaultModels: z.record(z.string(), z.string()).optional(),
      budgetUsd: z.number().nonnegative().nullable().optional(),
      confirmThresholdUsd: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const SequenceCreate = z.object({ title: z.string().optional(), summary: z.string().optional() });
export const SequenceUpdate = z.object({
  title: text.optional(),
  summary: text.optional(),
  order: z.number().int().nonnegative().optional(),
  locationRefId: z.string().nullable().optional(),
});

export const ShotCreate = z.object({
  description: z.string().optional(),
  durationSec: z.number().positive().max(120).optional(),
});
export const ShotUpdate = z.object({
  description: text.optional(),
  dialogue: text.nullable().optional(),
  sound: text.nullable().optional(),
  durationSec: z.number().positive().max(120).optional(),
  camera: fieldSchema(CameraAttrsSchema).optional(),
  recipeId: z.string().optional(),
  graph: z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).optional(),
  refIds: z.array(z.string()).optional(),
  framing: z.record(z.string(), z.enum(["left", "center", "right"])).nullable().optional(),
  selectedTakeId: z.string().nullable().optional(),
  status: z.enum(["to_write", "to_generate", "generating", "to_review", "approved"]).optional(),
  order: z.number().int().nonnegative().optional(),
});

export const TakeCreate = z.object({
  modelId: z.string().min(1),
  stage: z.enum(["sketch", "keyframe", "video"]),
  prompt: z.string().trim().min(1),
  negativePrompt: z.string().optional(),
  seed: z.number().int().optional(),
  durationSec: z.number().positive().optional(),
  parentTakeId: z.string().optional(),
  confirmedCostUsd: z.number().nonnegative().optional(),
});
export const TakeEstimate = z.object({ modelId: z.string().min(1), durationSec: z.number().positive().optional() });

const RefTag = z.enum(["character", "location", "object", "look", "composition", "free"]);
const RefView = z.enum([
  "face_front", "face_34", "profile", "full_body", "expression",
  "establishing", "angle_a", "angle_b", "detail", "mood", "palette", "untagged",
]);
export const ReferenceCreate = z.object({
  name: z.string().trim().min(1),
  tag: RefTag.optional(),
  scope: z.enum(["bible", "local"]).optional(),
  shotId: z.string().optional(),
  descriptor: z.string().optional(),
});
export const ReferenceUpdate = ReferenceCreate.partial();
export const VariantCreate = z.object({
  name: z.string().trim().min(1),
  views: z.array(z.object({ assetId: z.string(), view: RefView })).optional(),
});
export const VariantUpdate = VariantCreate.partial();
