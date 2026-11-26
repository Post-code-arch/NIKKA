import { and, eq, inArray, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isMockMode } from "@/lib/atlas/config";
import type { Origin } from "@/lib/domain/field";
import { DigestError, callJson } from "./llm";
import {
  BreakdownSchema,
  ConceptOptionsSchema,
  ConceptSchema,
  DiagnosisSchema,
  DigestStateSchema,
  ExtractionSchema,
  StoredBreakdownSchema,
  StoredConceptSchema,
  StoredTreatmentSchema,
  TreatmentSchema,
  type Breakdown,
  type Concept,
  type DigestState,
  type Level,
  type StoredBreakdown,
  type StoredConcept,
  type StoredTreatment,
  type Treatment,
} from "./schemas";

/**
 * Brief digester (PRD §6): diagnosis → faithful extraction → proposal of the
 * first missing level → validation level by level. Validating level 3 creates
 * the bible references (no images); level 4 creates sequences and shots.
 * Nothing here launches a paid image or video generation.
 */

function loadProject(projectId: string) {
  const project = getDb().select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new DigestError("Projet introuvable", 404);
  return project;
}

function readState(project: ReturnType<typeof loadProject>): DigestState {
  const parsed = DigestStateSchema.safeParse(project.digest ?? {});
  return parsed.success ? parsed.data : DigestStateSchema.parse({});
}

function save(projectId: string, state: DigestState, extra: Partial<typeof schema.projects.$inferInsert> = {}) {
  getDb()
    .update(schema.projects)
    .set({ digest: state, updatedAt: Date.now(), ...extra })
    .where(eq(schema.projects.id, projectId))
    .run();
}

export interface DigestView {
  briefRaw: string;
  maturity: number;
  state: DigestState;
  llm: { mock: boolean; model: string | null; estimatedUsdPerCall: number };
}

/** Rough estimate shown before any LLM call (PRD rule: no paid call without a visible cost). */
export function estimateLlmUsd(briefChars: number): number {
  if (isMockMode()) return 0;
  const inPrice = Number(process.env.NIKKA_LLM_USD_PER_MTOK_IN ?? 1);
  const outPrice = Number(process.env.NIKKA_LLM_USD_PER_MTOK_OUT ?? 4);
  const tokensIn = (briefChars + 4000) / 4;
  return Math.round(((tokensIn * inPrice + 3000 * outPrice) / 1e6) * 10000) / 10000;
}

export function getDigest(projectId: string): DigestView {
  const project = loadProject(projectId);
  return {
    briefRaw: project.briefRaw,
    maturity: project.maturity,
    state: readState(project),
    llm: { mock: isMockMode(), model: isMockMode() ? null : (process.env.NIKKA_LLM_MODEL ?? null), estimatedUsdPerCall: estimateLlmUsd(project.briefRaw.length) },
  };
}

// --- stamping ------------------------------------------------------------------------

function stampConcept(c: Concept, origin: Origin): StoredConcept {
  return {
    pitch: { value: c.pitch, origin },
    intention: { value: c.intention, origin },
    tone: { value: c.tone, origin },
    audience: { value: c.audience, origin },
    format: { value: c.format, origin },
  };
}

function stampTreatment(t: Treatment, origin: Origin): StoredTreatment {
  return {
    artDirection: { value: t.artDirection, origin },
    entities: t.entities.map((e) => ({ ...e, origin })),
    sequences: t.sequences.map((s) => ({ ...s, origin })),
  };
}

function stampBreakdown(b: Breakdown, origin: Origin): StoredBreakdown {
  return {
    sequences: b.sequences.map((s) => ({
      title: { value: s.title, origin },
      summary: { value: s.summary, origin },
      shots: s.shots.map((sh) => ({ ...sh, origin })),
    })),
  };
}

const isEmptyConcept = (c: Concept) => Object.values(c).every((v) => !v.trim());

/** What the next proposal builds on (plain values). */
function context(state: DigestState) {
  return {
    idea: state.idea,
    concept: state.concept,
    treatment: state.treatment && {
      artDirection: state.treatment.artDirection.value,
      entities: state.treatment.entities.map(({ name, tag, descriptor }) => ({ name, tag, descriptor })),
      sequences: state.treatment.sequences.map(({ title, summary, location }) => ({ title, summary, location })),
    },
  };
}

function levelPresent(state: DigestState, level: Level) {
  return level === 1 ? !!state.idea : level === 2 ? !!state.concept : level === 3 ? !!state.treatment : !!state.breakdown;
}

// --- steps ----------------------------------------------------------------------------

/** Paste a brief: diagnosis, extraction of covered levels, proposal of the first missing one. */
export async function analyzeBrief(projectId: string, briefRaw: string): Promise<DigestView> {
  const project = loadProject(projectId);
  const brief = briefRaw.trim();
  if (!brief) throw new DigestError("Le brief est vide", 400);
  const previous = readState(project);
  const diagnosis = await callJson("diagnose", DiagnosisSchema, { brief });
  const vars = { level: diagnosis.level, language: diagnosis.language };
  const ext = await callJson("extract", ExtractionSchema, { brief }, vars);

  const state: DigestState = DigestStateSchema.parse({ applied: previous.applied });
  state.diagnosis = diagnosis;
  state.idea = { value: ext.idea || brief.slice(0, 300), origin: "extracted" };
  if (ext.concept && !isEmptyConcept(ext.concept)) state.concept = stampConcept(ext.concept, "extracted");
  if (ext.treatment && (ext.treatment.entities.length || ext.treatment.sequences.length || ext.treatment.artDirection)) {
    state.treatment = stampTreatment(ext.treatment, "extracted");
  }
  if (ext.breakdown) state.breakdown = stampBreakdown(ext.breakdown, "extracted");
  save(projectId, state, { briefRaw, maturity: diagnosis.level, concept: null });

  // The first level the brief does not cover is proposed (what it partly states is passed on and kept).
  // A complete breakdown is only extracted: missing upper levels are proposed on request.
  const next = diagnosis.level < 4 ? ((diagnosis.level + 1) as Level) : undefined;
  if (next) return proposeLevel(projectId, next);
  return getDigest(projectId);
}

/** Proposes (or regenerates) a level from the levels above it. */
export async function proposeLevel(projectId: string, level: Level): Promise<DigestView> {
  const project = loadProject(projectId);
  const state = readState(project);
  const brief = project.briefRaw.trim();
  if (!brief || !state.idea) throw new DigestError("Analyse d'abord un brief", 400);
  const vars = { language: state.diagnosis?.language ?? "fr" };
  const ctx = context(state);

  if (level === 1) throw new DigestError("L'idée vient du brief : modifie-la directement", 400);
  if (level === 2) {
    // From a bare idea: 2-3 distinct directions to choose from. Otherwise one proposal.
    const fromIdea = (state.diagnosis?.level ?? 1) === 1 && state.concept?.pitch.origin !== "extracted";
    if (fromIdea) {
      const { options } = await callJson("concepts", ConceptOptionsSchema, { brief, context: ctx }, vars);
      state.conceptOptions = options;
      state.concept = undefined;
    } else {
      state.concept = stampConcept(await callJson("concept", ConceptSchema, { brief, context: ctx }, vars), "proposed");
    }
  } else if (level === 3) {
    if (!state.concept) throw new DigestError("Il faut d'abord un concept (niveau 2)", 400);
    state.treatment = stampTreatment(await callJson("treatment", TreatmentSchema, { brief, context: ctx }, vars), "proposed");
  } else {
    if (!state.treatment) throw new DigestError("Il faut d'abord un traitement (niveau 3)", 400);
    state.breakdown = stampBreakdown(await callJson("breakdown", BreakdownSchema, { brief, context: ctx }, vars), "proposed");
  }
  // A new proposal is not validated, nor anything below it.
  state.validatedLevel = Math.min(state.validatedLevel, level - 1);
  save(projectId, state);
  return getDigest(projectId);
}

/** Picks one of the concept directions proposed from an idea. */
export function chooseConcept(projectId: string, index: number): DigestView {
  const project = loadProject(projectId);
  const state = readState(project);
  const option = state.conceptOptions?.[index];
  if (!option) throw new DigestError("Piste introuvable", 404);
  state.concept = stampConcept(option, "proposed");
  state.validatedLevel = Math.min(state.validatedLevel, 1);
  save(projectId, state);
  return getDigest(projectId);
}

/** Inline edits of one level (the client marks edited items as validated). */
export function updateLevel(projectId: string, level: Level, data: unknown): DigestView {
  const project = loadProject(projectId);
  const state = readState(project);
  if (level === 1) state.idea = DigestStateSchema.shape.idea.unwrap().parse(data);
  if (level === 2) state.concept = StoredConceptSchema.parse(data);
  if (level === 3) state.treatment = StoredTreatmentSchema.parse(data);
  if (level === 4) state.breakdown = StoredBreakdownSchema.parse(data);
  // An edited level is no longer validated as a whole.
  state.validatedLevel = Math.min(state.validatedLevel, level - 1);
  save(projectId, state);
  return getDigest(projectId);
}

const validated = <T extends { origin: Origin }>(x: T): T => ({ ...x, origin: "validated" });

/**
 * Validates a level and every level above it that exists. Level 3 creates the bible
 * references; level 4 creates the sequences and shots.
 */
export function validateLevel(projectId: string, level: Level): DigestView {
  const project = loadProject(projectId);
  const state = readState(project);
  // The level itself is needed; upper levels may stay empty (e.g. a breakdown pasted as is).
  if (!levelPresent(state, level) || !state.idea) throw new DigestError(`Niveau ${level} manquant : impossible de valider`, 400);

  if (state.idea) state.idea = validated(state.idea);
  if (level >= 2 && state.concept) {
    const c = state.concept;
    state.concept = { pitch: validated(c.pitch), intention: validated(c.intention), tone: validated(c.tone), audience: validated(c.audience), format: validated(c.format) };
  }
  if (level >= 3 && state.treatment) {
    const t = state.treatment;
    state.treatment = { artDirection: validated(t.artDirection), entities: t.entities.map(validated), sequences: t.sequences.map(validated) };
  }
  if (level >= 4 && state.breakdown) {
    state.breakdown = {
      sequences: state.breakdown.sequences.map((s) => ({ title: validated(s.title), summary: validated(s.summary), shots: s.shots.map(validated) })),
    };
  }

  getDb().transaction(() => {
    if (level >= 3) applyTreatment(projectId, state);
    if (level >= 4) applyBreakdown(projectId, state);
    state.validatedLevel = Math.max(state.validatedLevel, level);
    save(projectId, state, level >= 2 && state.concept ? { concept: state.concept } : {});
  });
  return getDigest(projectId);
}

// --- wiring into the project ------------------------------------------------------------

function projectRefs(projectId: string) {
  return getDb().select().from(schema.references).where(eq(schema.references.projectId, projectId)).all();
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Entities become bible references (no images). An existing reference is never rewritten (rule 7). */
function applyTreatment(projectId: string, state: DigestState) {
  const db = getDb();
  const existing = projectRefs(projectId);
  const created: string[] = [];
  for (const e of state.treatment?.entities ?? []) {
    if (existing.some((r) => same(r.name, e.name))) continue;
    const ref = db.insert(schema.references).values({ projectId, scope: "bible", tag: e.tag, name: e.name, descriptor: e.descriptor }).returning().get();
    db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale" }).run();
    existing.push(ref);
    created.push(ref.id);
  }
  state.applied.referenceIds = [...new Set([...state.applied.referenceIds, ...created])];
}

function recipeFor(tags: string[]) {
  if (tags.includes("character")) return "character";
  if (tags.includes("location")) return "location";
  if (tags.includes("object")) return "object";
  return "free";
}

/** Sequences and shots, with refIds, camera and recipe. Replaces what a previous validation created. */
function applyBreakdown(projectId: string, state: DigestState) {
  const db = getDb();
  const previous = state.applied.sequenceIds;
  if (previous.length) {
    const shots = db.select({ id: schema.shots.id }).from(schema.shots).where(inArray(schema.shots.sequenceId, previous)).all();
    const takes = shots.length ? db.select({ id: schema.takes.id }).from(schema.takes).where(inArray(schema.takes.shotId, shots.map((s) => s.id))).all() : [];
    if (takes.length) {
      throw new DigestError("Des plans créés par le digester ont déjà des prises : modifie-les dans le storyboard plutôt que de revalider le découpage", 409);
    }
    db.delete(schema.sequences).where(and(eq(schema.sequences.projectId, projectId), inArray(schema.sequences.id, previous))).run();
  }
  const refs = projectRefs(projectId);
  const refByName = (name: string) => refs.find((r) => same(r.name, name));
  const start = (db.select({ m: max(schema.sequences.order) }).from(schema.sequences).where(eq(schema.sequences.projectId, projectId)).get()?.m ?? -1) + 1;
  const ids: string[] = [];
  state.breakdown?.sequences.forEach((s, i) => {
    const treatmentSeq = state.treatment?.sequences.find((t) => same(t.title, s.title.value));
    const location = treatmentSeq?.location ? refByName(treatmentSeq.location) : undefined;
    const seq = db
      .insert(schema.sequences)
      .values({ projectId, order: start + i, title: s.title, summary: s.summary, locationRefId: location?.tag === "location" ? location.id : null })
      .returning()
      .get();
    ids.push(seq.id);
    s.shots.forEach((sh, j) => {
      const shotRefs = sh.refs.map(refByName).filter((r): r is NonNullable<typeof r> => !!r);
      db.insert(schema.shots)
        .values({
          sequenceId: seq.id,
          order: j,
          description: { value: sh.description, origin: "validated" },
          dialogue: sh.dialogue ? { value: sh.dialogue, origin: "validated" } : null,
          sound: sh.sound ? { value: sh.sound, origin: "validated" } : null,
          durationSec: sh.durationSec,
          camera: { value: sh.camera, origin: "validated" },
          recipeId: recipeFor(shotRefs.map((r) => r.tag)),
          refIds: [...new Set(shotRefs.map((r) => r.id))],
          status: "to_generate",
        })
        .run();
    });
  });
  state.applied.sequenceIds = ids;
}
