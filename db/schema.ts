import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CameraAttrs } from "@/lib/camera/types";
import type { Field } from "@/lib/domain/field";

/** PRD §5. Ids are UUID strings, timestamps are epoch milliseconds. */

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const now = (name: string) => integer(name).notNull().$defaultFn(() => Date.now());

export type DigestedConcept = {
  pitch: Field<string>;
  intention: Field<string>;
  tone: Field<string>;
  audience: Field<string>;
  format: Field<string>;
};

export type ProjectSettings = {
  /** Default model id per role, e.g. { sketch: "...", keyframe: "...", video: "..." } */
  defaultModels: Record<string, string>;
  budgetUsd?: number;
  /** Generations above this estimate need an explicit confirmation (PRD §11). */
  confirmThresholdUsd?: number;
};

export const projects = sqliteTable("projects", {
  id: id(),
  name: text("name").notNull(),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
  briefRaw: text("brief_raw").notNull().default(""),
  maturity: integer("maturity").notNull().default(1),
  concept: text("concept", { mode: "json" }).$type<DigestedConcept | null>(),
  settings: text("settings", { mode: "json" })
    .$type<ProjectSettings>()
    .notNull()
    .$defaultFn(() => ({ defaultModels: {} })),
});

export const sequences = sqliteTable(
  "sequences",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    title: text("title", { mode: "json" }).$type<Field<string>>().notNull(),
    summary: text("summary", { mode: "json" }).$type<Field<string>>().notNull(),
    locationRefId: text("location_ref_id"),
  },
  (t) => [index("sequences_project_idx").on(t.projectId)],
);

export type ShotStatus = "to_write" | "to_generate" | "generating" | "to_review" | "approved";
export type ShotGraph = { nodes: unknown[]; edges: unknown[] };

export const shots = sqliteTable(
  "shots",
  {
    id: id(),
    sequenceId: text("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    description: text("description", { mode: "json" }).$type<Field<string>>().notNull(),
    dialogue: text("dialogue", { mode: "json" }).$type<Field<string> | null>(),
    sound: text("sound", { mode: "json" }).$type<Field<string> | null>(),
    durationSec: real("duration_sec").notNull().default(3),
    camera: text("camera", { mode: "json" }).$type<Field<CameraAttrs>>().notNull(),
    recipeId: text("recipe_id").notNull().default("free"),
    graph: text("graph", { mode: "json" })
      .$type<ShotGraph>()
      .notNull()
      .$defaultFn(() => ({ nodes: [], edges: [] })),
    refIds: text("ref_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    framing: text("framing", { mode: "json" }).$type<Record<string, "left" | "center" | "right"> | null>(),
    selectedTakeId: text("selected_take_id"),
    status: text("status").$type<ShotStatus>().notNull().default("to_write"),
  },
  (t) => [index("shots_sequence_idx").on(t.sequenceId)],
);

export type TakeStage = "sketch" | "keyframe" | "video";
export type TakeStatus = "queued" | "processing" | "completed" | "failed";

export const takes = sqliteTable(
  "takes",
  {
    id: id(),
    shotId: text("shot_id").notNull().references(() => shots.id, { onDelete: "cascade" }),
    stage: text("stage").$type<TakeStage>().notNull(),
    assetId: text("asset_id").references(() => assets.id),
    parentTakeId: text("parent_take_id"),
    model: text("model").notNull(),
    prompt: text("prompt").notNull(),
    params: text("params", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    seed: integer("seed"),
    predictionId: text("prediction_id"),
    status: text("status").$type<TakeStatus>().notNull().default("queued"),
    costEstimatedUsd: real("cost_estimated_usd").notNull(),
    costActualUsd: real("cost_actual_usd"),
    error: text("error"),
    createdAt: now("created_at"),
  },
  (t) => [index("takes_shot_idx").on(t.shotId)],
);

export type ReferenceTag = "character" | "location" | "object" | "look" | "composition" | "free";
export type RefView =
  | "face_front" | "face_34" | "profile" | "full_body" | "expression"
  | "establishing" | "angle_a" | "angle_b" | "detail" | "mood" | "palette" | "untagged";

export const references = sqliteTable(
  "references",
  {
    id: id(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    scope: text("scope").$type<"bible" | "local">().notNull().default("local"),
    shotId: text("shot_id").references(() => shots.id, { onDelete: "cascade" }),
    tag: text("tag").$type<ReferenceTag>().notNull().default("free"),
    name: text("name").notNull(),
    /** Frozen descriptor injected verbatim into prompts, never rewritten by an LLM. */
    descriptor: text("descriptor").notNull().default(""),
    updatedAt: now("updated_at"),
  },
  (t) => [index("references_project_idx").on(t.projectId)],
);

export const referenceVariants = sqliteTable(
  "reference_variants",
  {
    id: id(),
    referenceId: text("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    views: text("views", { mode: "json" })
      .$type<{ assetId: string; view: RefView }[]>()
      .notNull()
      .$defaultFn(() => []),
  },
  (t) => [index("variants_reference_idx").on(t.referenceId)],
);

export const assets = sqliteTable(
  "assets",
  {
    id: id(),
    kind: text("kind").$type<"image" | "video">().notNull(),
    /** Path relative to the project root, under storage/assets/. */
    path: text("path").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSec: real("duration_sec"),
    sha256: text("sha256").notNull(),
    createdAt: now("created_at"),
  },
  (t) => [index("assets_sha_idx").on(t.sha256)],
);

export type JobStatus = "active" | "completed" | "failed";

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    takeId: text("take_id").notNull().references(() => takes.id, { onDelete: "cascade" }),
    predictionId: text("prediction_id").notNull(),
    endpoint: text("endpoint").$type<"generateImage" | "generateVideo">().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("active"),
    attempts: integer("attempts").notNull().default(0),
    lastPolledAt: integer("last_polled_at"),
    nextPollAt: integer("next_poll_at").notNull().$defaultFn(() => Date.now()),
    error: text("error"),
    createdAt: now("created_at"),
  },
  (t) => [index("jobs_status_idx").on(t.status)],
);

export type Project = typeof projects.$inferSelect;
export type Sequence = typeof sequences.$inferSelect;
export type Shot = typeof shots.$inferSelect;
export type Take = typeof takes.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type ReferenceVariant = typeof referenceVariants.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Job = typeof jobs.$inferSelect;
