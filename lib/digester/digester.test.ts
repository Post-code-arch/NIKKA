import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRIEF_BREAKDOWN, BRIEF_CONCEPT, BRIEF_SENTENCE } from "./fixtures/briefs";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-digest-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_DB_PATH = path.join(dir, "test.db");
  process.env.NIKKA_ASSETS_DIR = path.join(dir, "assets");
});
afterAll(async () => {
  const { setDigesterChat } = await import("./llm");
  setDigesterChat(null);
  await rm(dir, { recursive: true, force: true });
});

async function project(name: string) {
  const { getDb, schema } = await import("@/db");
  return getDb().insert(schema.projects).values({ name, settings: { defaultModels: {} } }).returning().get();
}

describe("digester (mock)", () => {
  it("one sentence → level 1, 2-3 concept directions; choose, then descend to a text storyboard (PRD §13.1)", async () => {
    const { analyzeBrief, chooseConcept, validateLevel, proposeLevel } = await import("./service");
    const { getDb, schema } = await import("@/db");
    const p = await project("Phrase");
    let v = await analyzeBrief(p.id, BRIEF_SENTENCE);
    expect(v.state.diagnosis?.level).toBe(1);
    expect(v.state.idea?.origin).toBe("extracted");
    expect(v.state.conceptOptions?.length).toBeGreaterThanOrEqual(2);
    expect(v.state.concept).toBeUndefined();

    v = chooseConcept(p.id, 1);
    expect(v.state.concept?.pitch.origin).toBe("proposed");
    v = validateLevel(p.id, 2);
    expect(v.state.validatedLevel).toBe(2);

    v = await proposeLevel(p.id, 3);
    expect(v.state.treatment?.entities.every((e) => e.origin === "proposed")).toBe(true);
    v = validateLevel(p.id, 3);
    const refs = getDb().select().from(schema.references).where(eq(schema.references.projectId, p.id)).all();
    expect(refs.length).toBe(v.state.treatment!.entities.length);
    expect(refs.every((r) => r.scope === "bible")).toBe(true);

    v = await proposeLevel(p.id, 4);
    v = validateLevel(p.id, 4);
    const seqs = getDb().select().from(schema.sequences).where(eq(schema.sequences.projectId, p.id)).all();
    expect(seqs.length).toBe(v.state.breakdown!.sequences.length);
    const shots = getDb().select().from(schema.shots).all().filter((s) => seqs.some((q) => q.id === s.sequenceId));
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.some((s) => s.refIds.length > 0)).toBe(true);
    expect(shots.every((s) => s.camera.origin === "validated")).toBe(true);

    // Re-validating the breakdown replaces what it created, nothing is doubled.
    validateLevel(p.id, 4);
    expect(getDb().select().from(schema.sequences).where(eq(schema.sequences.projectId, p.id)).all()).toHaveLength(seqs.length);
  });

  it("a paragraph → level 2, extracted concept, treatment proposed", async () => {
    const { analyzeBrief } = await import("./service");
    const p = await project("Concept");
    const v = await analyzeBrief(p.id, BRIEF_CONCEPT);
    expect(v.state.diagnosis?.level).toBe(2);
    expect(v.state.concept?.pitch.origin).toBe("extracted");
    expect(v.state.concept?.format.value).toMatch(/60 secondes/);
    expect(v.state.conceptOptions).toBeUndefined();
    expect(v.state.treatment?.artDirection.origin).toBe("proposed");
  });

  it("a 10-shot breakdown → level 4, extracted without inventing (PRD §13.2)", async () => {
    const { analyzeBrief } = await import("./service");
    const p = await project("Découpage");
    const v = await analyzeBrief(p.id, BRIEF_BREAKDOWN);
    expect(v.state.diagnosis?.level).toBe(4);
    const shots = v.state.breakdown!.sequences.flatMap((s) => s.shots);
    expect(v.state.breakdown!.sequences.map((s) => s.title.value)).toEqual(["Le quai", "L'attente"]);
    expect(shots).toHaveLength(10);
    expect(shots.every((s) => s.origin === "extracted")).toBe(true);
    expect(shots.map((s) => s.camera.scale)).toEqual([
      "extreme_wide", "wide", "close", "insert", "medium", "medium", "medium_close", "extreme_close", "medium", "extreme_wide",
    ]);
    expect(shots[1].camera).toMatchObject({ movement: "truck_right", speed: "slow" });
    expect(shots[5].camera).toMatchObject({ angle: "high", movement: "pan_left" });
    expect(shots[8].camera).toMatchObject({ angle: "low", movement: "zoom_in" });
    expect(shots[9].camera.movement).toBe("drone");
    expect(shots.map((s) => s.durationSec)).toEqual([5, 4, 3, 2, 4, 5, 3, 2, 3, 6]);
    expect(shots[6].dialogue).toBe("Il viendra");
    expect(shots[4].sound).toMatch(/vent/);
    expect(shots[1].refs).toContain("Lina");
    // Nothing invented in the descriptions: each one comes from the brief.
    for (const s of shots) expect(BRIEF_BREAKDOWN).toContain(s.description.slice(0, 20));
    expect(v.state.concept).toBeUndefined(); // nothing proposed on its own

    // Validated as is: sequences, shots and references straight into the storyboard.
    const { validateLevel } = await import("./service");
    const { getDb, schema } = await import("@/db");
    validateLevel(p.id, 4);
    const seqs = getDb().select().from(schema.sequences).where(eq(schema.sequences.projectId, p.id)).all();
    expect(seqs.map((s) => s.title.value)).toEqual(["Le quai", "L'attente"]);
    const dbShots = getDb().select().from(schema.shots).all().filter((s) => seqs.some((q) => q.id === s.sequenceId));
    expect(dbShots).toHaveLength(10);
    const lina = getDb().select().from(schema.references).where(eq(schema.references.projectId, p.id)).all().find((r) => r.name === "Lina")!;
    expect(dbShots.filter((s) => s.refIds.includes(lina.id))).toHaveLength(6); // shots 2, 3, 5, 6, 7, 10
    expect(lina.descriptor).toMatch(/manteau rouge/); // as written in the brief
  });
});

describe("LLM output validation", () => {
  it("retries once with the error, then succeeds", async () => {
    const { callJson, setDigesterChat } = await import("./llm");
    const { DiagnosisSchema } = await import("./schemas");
    const seen: string[] = [];
    const answers = ['{"level": 7}', '{"level": 2, "language": "fr", "summary": "ok", "gaps": {}}'];
    setDigesterChat(async (messages) => {
      seen.push(messages.at(-1)!.content);
      return answers.shift()!;
    });
    const d = await callJson("diagnose", DiagnosisSchema, { brief: "x" });
    expect(d.level).toBe(2);
    expect(seen[1]).toMatch(/does not match the expected shape: level/);
    setDigesterChat(null);
  });

  it("gives up after the retry", async () => {
    const { callJson, setDigesterChat } = await import("./llm");
    const { DiagnosisSchema } = await import("./schemas");
    setDigesterChat(async () => "not json");
    await expect(callJson("diagnose", DiagnosisSchema, { brief: "x" })).rejects.toThrow(/invalide après une nouvelle tentative/);
    setDigesterChat(null);
  });

  it("system prompts come from editable files and keep extraction apart from invention", async () => {
    const { systemPrompt } = await import("./llm");
    const p = systemPrompt("extract", { level: 3, language: "fr" });
    expect(p).toMatch(/never invent/);
    expect(p).toMatch(/diagnosed at level 3/);
  });
});
