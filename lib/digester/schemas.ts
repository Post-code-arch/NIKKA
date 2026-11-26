import { z } from "zod";
import { CameraAngleSchema, CameraMovementSchema, ShotScaleSchema } from "@/lib/camera/types";
import { OriginSchema, fieldSchema } from "@/lib/domain/field";

/**
 * PRD §6. Two families of schemas:
 * - raw LLM outputs (plain values), validated by Zod with one retry;
 * - the stored digest state, where every piece carries its origin
 *   (extracted / proposed / validated).
 */

export const LEVELS = [1, 2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_NAME: Record<Level, string> = { 1: "Idée", 2: "Concept", 3: "Traitement", 4: "Découpage" };

const text = z.string().trim();

// --- raw LLM outputs -------------------------------------------------------------

export const DiagnosisSchema = z.object({
  level: z.number().int().min(1).max(4),
  language: text.min(2).max(20),
  summary: text,
  gaps: z.object({
    concept: z.array(text).default([]),
    treatment: z.array(text).default([]),
    breakdown: z.array(text).default([]),
  }),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

export const ConceptSchema = z.object({
  pitch: text,
  intention: text,
  tone: text,
  audience: text,
  format: text,
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ConceptOptionsSchema = z.object({
  options: z.array(ConceptSchema.extend({ title: text.min(1) })).min(2).max(3),
});

export const EntityTagSchema = z.enum(["character", "location", "object", "look"]);
export const EntitySchema = z.object({ name: text.min(1), tag: EntityTagSchema, descriptor: text });
export const TreatmentSequenceSchema = z.object({ title: text.min(1), summary: text, location: text.optional() });

export const TreatmentSchema = z.object({
  artDirection: text,
  entities: z.array(EntitySchema),
  sequences: z.array(TreatmentSequenceSchema),
});
export type Treatment = z.infer<typeof TreatmentSchema>;

export const ShotCameraSchema = z.object({
  scale: ShotScaleSchema,
  angle: CameraAngleSchema.default("eye_level"),
  movement: CameraMovementSchema.default("static"),
  speed: z.enum(["slow", "medium", "fast"]).optional(),
});

export const BreakdownShotSchema = z.object({
  description: text.min(1),
  dialogue: text.optional(),
  sound: text.optional(),
  durationSec: z.number().positive().max(60).default(4),
  camera: ShotCameraSchema,
  /** Names of treatment entities seen in the shot. */
  refs: z.array(text).default([]),
});
export const BreakdownSchema = z.object({
  sequences: z.array(z.object({ title: text.min(1), summary: text.default(""), shots: z.array(BreakdownShotSchema).min(1) })).min(1),
});
export type Breakdown = z.infer<typeof BreakdownSchema>;

export const ExtractionSchema = z.object({
  idea: text,
  concept: ConceptSchema.nullable(),
  treatment: TreatmentSchema.nullable(),
  breakdown: BreakdownSchema.nullable(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// --- stored state --------------------------------------------------------------------

export const StoredConceptSchema = z.object({
  pitch: fieldSchema(z.string()),
  intention: fieldSchema(z.string()),
  tone: fieldSchema(z.string()),
  audience: fieldSchema(z.string()),
  format: fieldSchema(z.string()),
});
export type StoredConcept = z.infer<typeof StoredConceptSchema>;

export const StoredTreatmentSchema = z.object({
  artDirection: fieldSchema(z.string()),
  entities: z.array(EntitySchema.extend({ origin: OriginSchema })),
  sequences: z.array(TreatmentSequenceSchema.extend({ origin: OriginSchema })),
});
export type StoredTreatment = z.infer<typeof StoredTreatmentSchema>;

export const StoredShotSchema = BreakdownShotSchema.extend({ origin: OriginSchema });
export type StoredShot = z.infer<typeof StoredShotSchema>;
export const StoredBreakdownSchema = z.object({
  sequences: z.array(
    z.object({ title: fieldSchema(z.string()), summary: fieldSchema(z.string()), shots: z.array(StoredShotSchema) }),
  ),
});
export type StoredBreakdown = z.infer<typeof StoredBreakdownSchema>;

export const DigestStateSchema = z.object({
  diagnosis: DiagnosisSchema.optional(),
  idea: fieldSchema(z.string()).optional(),
  conceptOptions: ConceptOptionsSchema.shape.options.optional(),
  concept: StoredConceptSchema.optional(),
  treatment: StoredTreatmentSchema.optional(),
  breakdown: StoredBreakdownSchema.optional(),
  /** Highest level validated by the user (0: nothing yet). */
  validatedLevel: z.number().int().min(0).max(4).default(0),
  /** What the last validations created, so a new validation can replace it. */
  applied: z.object({ referenceIds: z.array(z.string()).default([]), sequenceIds: z.array(z.string()).default([]) }).default({ referenceIds: [], sequenceIds: [] }),
});
export type DigestState = z.infer<typeof DigestStateSchema>;
