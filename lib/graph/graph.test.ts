import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RECIPE_ORDER, buildRecipeGraph, refIdsFromGraph, syncReferenceNodes } from "@/lib/recipes";
import { NODE_SPECS, isValidEdge } from "./types";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-graph-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_MOCK_DELAY_MS = "20";
  process.env.NIKKA_ASSETS_DIR = path.join(dir, "assets");
  process.env.NIKKA_DB_PATH = path.join(dir, "test.db");
});
afterAll(async () => {
  const { stopPoller } = await import("@/lib/jobs/poller");
  stopPoller();
  await rm(dir, { recursive: true, force: true });
});

describe("recipes", () => {
  const refs = [{ id: "lina", tag: "character" as const }, { id: "quai", tag: "location" as const }];
  it.each(RECIPE_ORDER)("%s builds a valid graph with typed links", (recipe) => {
    const g = buildRecipeGraph(recipe, refs, { t2i: "mock/text-to-image", i2i: "mock/edit-multi-ref", i2v: "mock/image-to-video" });
    expect(g.edges.length).toBeGreaterThan(0);
    for (const e of g.edges) expect(isValidEdge(g, e)).toBe(true);
    expect(g.nodes.some((n) => NODE_SPECS[n.type].generates === "video")).toBe(true);
  });

  it("character recipe = refs → selector → prompt → multi-ref edit → take → video → take", () => {
    const g = buildRecipeGraph("character", refs);
    expect(g.nodes.map((n) => n.type).sort()).toEqual(
      ["imageEdit", "promptBuilder", "refSelector", "reference", "reference", "take", "take", "videoGen"].sort(),
    );
  });

  it("rejects links between different port types", () => {
    const g = buildRecipeGraph("character", refs);
    const prompt = g.nodes.find((n) => n.type === "promptBuilder")!;
    const video = g.nodes.find((n) => n.type === "videoGen")!;
    expect(isValidEdge(g, { source: prompt.id, sourceHandle: "prompt", target: video.id, targetHandle: "start" })).toBe(false);
  });

  it("keeps Reference nodes in step with refIds", () => {
    const g = buildRecipeGraph("character", refs);
    const g2 = syncReferenceNodes(g, ["lina", "neon"]);
    expect(refIdsFromGraph(g2).sort()).toEqual(["lina", "neon"]);
    const neon = g2.nodes.find((n) => n.data.referenceId === "neon")!;
    expect(g2.edges.filter((e) => e.source === neon.id).length).toBe(2); // selector + prompt
    for (const e of g2.edges) expect(isValidEdge(g2, e)).toBe(true);
  });
});

async function waitTakes(shotId: string) {
  const { getDb, schema } = await import("@/db");
  const { pollDueJobs } = await import("@/lib/jobs/poller");
  for (let i = 0; i < 100; i++) {
    await pollDueJobs(Date.now() + 60_000);
    const all = getDb().select().from(schema.takes).where(eq(schema.takes.shotId, shotId)).all();
    if (all.every((t) => t.status === "completed" || t.status === "failed")) return all;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("takes never finished");
}

describe("PRD §13.4: keyframe, 4 variants, choose, animate with a slow dolly in (mock)", () => {
  it("runs the character recipe end to end", async () => {
    const { getDb, schema } = await import("@/db");
    const { ensureShotGraph, runShot, selectTake, estimateRun } = await import("./run");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "P", settings: { defaultModels: { video: "mock/image-to-video" } } }).returning().get();
    const face = await storeAsset(makeMockPng("aa0000"), "image/png", "face.png");
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "Lina", tag: "character", descriptor: "Lina, manteau rouge." }).returning().get();
    db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale", views: [{ assetId: face.id, view: "face_front" }] }).run();
    const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const shot = db.insert(schema.shots).values({
      sequenceId: seq.id, order: 0, durationSec: 5, refIds: [ref.id],
      description: { value: "Lina attend sur le quai", origin: "validated" },
      camera: { value: { scale: "close", angle: "eye_level", movement: "dolly_in", speed: "slow" }, origin: "validated" },
    }).returning().get();

    const { graph, recipeId } = ensureShotGraph(shot.id);
    expect(recipeId).toBe("character");
    expect(graph.nodes.find((n) => n.type === "reference")?.data.referenceId).toBe(ref.id);

    // 1. keyframe
    const first = await runShot(shot.id, { until: "keyframe" });
    expect(first.takes).toHaveLength(1);
    expect(first.takes[0].prompt).toBe("Lina, manteau rouge. Lina attend sur le quai. Close-up on the face.");
    expect(first.takes[0].params.images).toHaveLength(1);

    // 2. four variants: a batch always asks for confirmation
    const est = estimateRun(shot.id, { until: "keyframe", variants: 4 });
    expect(est.needsConfirmation).toBe(true);
    await expect(runShot(shot.id, { until: "keyframe", variants: 4 })).rejects.toThrow(/Confirmation/);
    const four = await runShot(shot.id, { until: "keyframe", variants: 4, confirmedCostUsd: est.costEstimatedUsd });
    expect(four.takes).toHaveLength(4);
    expect(new Set(four.takes.map((t) => t.seed)).size).toBe(4);
    await waitTakes(shot.id);

    // 3. choose the third variant
    selectTake(shot.id, four.takes[2].id);

    // 4. animate: start image = the retained keyframe, slow dolly in in the prompt
    const anim = await runShot(shot.id, { until: "video" });
    expect(anim.takes[0].parentTakeId).toBe(four.takes[2].id);
    expect(anim.takes[0].prompt).toMatch(/dollies in toward the subject, slow and smooth/);
    const all = await waitTakes(shot.id);
    expect(all.filter((t) => t.stage === "keyframe")).toHaveLength(5); // nothing overwritten
    expect(all.find((t) => t.id === anim.takes[0].id)?.status).toBe("completed");
  }, 60_000);

  it("locked seed gives seed, seed+1… across variants", async () => {
    const { getDb, schema } = await import("@/db");
    const { ensureShotGraph, runShot, writeGraph } = await import("./run");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "L", settings: { defaultModels: {} } }).returning().get();
    const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const shot = db.insert(schema.shots).values({
      sequenceId: seq.id, order: 0, description: { value: "Un phare", origin: "validated" },
      camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" },
    }).returning().get();
    const { graph } = ensureShotGraph(shot.id);
    const gen = graph.nodes.find((n) => n.type === "imageGen")!;
    gen.data.seedLocked = true;
    gen.data.seed = 1000;
    writeGraph(shot.id, graph);
    const r = await runShot(shot.id, { nodeId: gen.id, variants: 3, confirmedCostUsd: 1 });
    expect(r.takes.map((t) => t.seed)).toEqual([1000, 1001, 1002]);
  });

  it("continuity starts from the last frame of the previous shot's video", async () => {
    const { getDb, schema } = await import("@/db");
    const { applyRecipe, runShot, selectTake } = await import("./run");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "C", settings: { defaultModels: {} } }).returning().get();
    const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const mk = (order: number) => db.insert(schema.shots).values({
      sequenceId: seq.id, order, description: { value: `Plan ${order}`, origin: "validated" },
      camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" },
    }).returning().get();
    const a = mk(0);
    const b = mk(1);
    await runShot(a.id, { until: "keyframe" });
    let takes = await waitTakes(a.id);
    selectTake(a.id, takes[0].id);
    await runShot(a.id, { until: "video" });
    takes = await waitTakes(a.id);
    const video = takes.find((t) => t.stage === "video")!;
    selectTake(a.id, video.id);

    applyRecipe(b.id, "continuity");
    const r = await runShot(b.id, { until: "video" });
    expect(r.takes[0].parentTakeId).toBe(video.id);
    expect((r.takes[0].params as { image?: string }).image).toMatch(/^mock:\/\/upload\//);
  }, 60_000);
});
