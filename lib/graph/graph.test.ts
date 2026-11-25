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

describe("recipe templates", () => {
  const refs = [{ id: "lina", tag: "character" as const }, { id: "quai", tag: "location" as const }];
  it.each(RECIPE_ORDER)("%s builds a valid graph with typed links", (recipe) => {
    const g = buildRecipeGraph(recipe, refs, { t2i: "mock/text-to-image", i2i: "mock/edit-multi-ref", i2v: "mock/image-to-video" });
    expect(g.edges.length).toBeGreaterThan(0);
    for (const e of g.edges) expect(isValidEdge(g, e)).toBe(true);
    expect(g.nodes.some((n) => NODE_SPECS[n.type].generates === "video")).toBe(true);
  });

  it("character template = refs → selector + prompt du plan → multi-ref edit → video", () => {
    const g = buildRecipeGraph("character", refs);
    expect(g.nodes.map((n) => n.type).sort()).toEqual(
      ["imageEdit", "promptBuilder", "refSelector", "reference", "reference", "videoGen"].sort(),
    );
  });

  it("inserting twice never reuses node ids", () => {
    const a = buildRecipeGraph("free", []);
    const b = buildRecipeGraph("free", [], {}, a.nodes, { x: 0, y: 400 });
    const ids = [...a.nodes, ...b.nodes].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.nodes[0].position.y).toBeGreaterThanOrEqual(400);
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
    for (const e of g2.edges) expect(isValidEdge(g2, e)).toBe(true);
  });
});

async function settle(shotId: string) {
  const { getDb, schema } = await import("@/db");
  const { pollDueJobs } = await import("@/lib/jobs/poller");
  for (let i = 0; i < 100; i++) {
    await pollDueJobs(Date.now() + 60_000);
    const runs = getDb().select().from(schema.nodeRuns).where(eq(schema.nodeRuns.shotId, shotId)).all();
    if (runs.every((r) => r.status === "completed" || r.status === "failed")) return runs;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("runs never finished");
}

async function makeShot(name: string, extra: Record<string, unknown> = {}) {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  const project = db.insert(schema.projects).values({ name, settings: { defaultModels: {} } }).returning().get();
  const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
  const mk = (order: number) =>
    db.insert(schema.shots).values({
      sequenceId: seq.id, order, durationSec: 5,
      description: { value: "Lina attend sur le quai", origin: "validated" },
      camera: { value: { scale: "close", angle: "eye_level", movement: "dolly_in", speed: "slow" }, origin: "validated" },
      ...extra,
    }).returning().get();
  return { db, schema, project, seq, mk };
}

describe("free canvas (mock)", () => {
  it("starts empty; user-built text → image → video runs; results stay in the canvas until sent", async () => {
    const { db, schema, mk } = await makeShot("Free");
    const shot = mk(0);
    const { getCanvas, writeGraph, runNode, sendToShot, estimateRun } = await import("./run");
    expect(getCanvas(shot.id).graph.nodes).toHaveLength(0);

    writeGraph(shot.id, {
      nodes: [
        { id: "t", type: "text", position: { x: 0, y: 0 }, data: { text: "Un phare dans la tempête, gravure" } },
        { id: "img", type: "imageGen", position: { x: 300, y: 0 }, data: { modelId: "mock/text-to-image" } },
        { id: "vid", type: "videoGen", position: { x: 600, y: 0 }, data: { modelId: "mock/image-to-video" } },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "prompt", target: "img", targetHandle: "prompt" },
        { id: "e2", source: "img", sourceHandle: "image", target: "vid", targetHandle: "start" },
        { id: "e3", source: "t", sourceHandle: "prompt", target: "vid", targetHandle: "prompt" },
      ],
    });

    // 4 variants of the image: a batch always needs a confirmed total.
    const est = estimateRun(shot.id, { nodeId: "img", variants: 4 });
    expect(est.needsConfirmation).toBe(true);
    await expect(runNode(shot.id, { nodeId: "img", variants: 4 })).rejects.toThrow(/Confirmation/);
    const four = await runNode(shot.id, { nodeId: "img", variants: 4, confirmedCostUsd: est.costEstimatedUsd });
    expect(four.runs).toHaveLength(4);
    expect(four.runs[0].prompt).toBe("Un phare dans la tempête, gravure"); // free text, as written
    await settle(shot.id);

    // Choose the third result: the video starts from it.
    const g = getCanvas(shot.id).graph;
    g.nodes.find((n) => n.id === "img")!.data.selectedRunId = four.runs[2].id;
    writeGraph(shot.id, g);
    const anim = await runNode(shot.id, { nodeId: "vid" });
    const runs = await settle(shot.id);
    expect(runs.find((r) => r.id === anim.runs[0].id)?.status).toBe("completed");
    expect(String(anim.runs[0].params.image)).toMatch(/^mock:\/\/upload\//);

    // Nothing reached the storyboard yet…
    expect(db.select().from(schema.takes).where(eq(schema.takes.shotId, shot.id)).all()).toHaveLength(0);
    // …until the user sends a result.
    const take = sendToShot(anim.runs[0].id);
    expect(take.stage).toBe("video");
    expect(take.costEstimatedUsd).toBe(0); // already counted on the run
    expect(sendToShot(anim.runs[0].id).id).toBe(take.id); // idempotent
  }, 60_000);

  it("prompt du plan assembles bible descriptors + action + camera; imageEdit takes imported images", async () => {
    const { db, schema, project, mk } = await makeShot("Plan");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "Lina", tag: "character", descriptor: "Lina, manteau rouge." }).returning().get();
    const shot = mk(0);
    const photo = await storeAsset(makeMockPng("00aa00"), "image/png", "photo.png");
    const { writeGraph, runNode } = await import("./run");
    writeGraph(shot.id, {
      nodes: [
        { id: "r", type: "reference", position: { x: 0, y: 0 }, data: { referenceId: ref.id } },
        { id: "p", type: "promptBuilder", position: { x: 300, y: 0 }, data: {} },
        { id: "in", type: "imageInput", position: { x: 0, y: 200 }, data: { assetId: photo.id } },
        { id: "edit", type: "imageEdit", position: { x: 600, y: 0 }, data: { modelId: "mock/edit-multi-ref" } },
      ],
      edges: [
        { id: "e1", source: "r", sourceHandle: "ref", target: "p", targetHandle: "refs" },
        { id: "e2", source: "p", sourceHandle: "prompt", target: "edit", targetHandle: "prompt" },
        { id: "e3", source: "in", sourceHandle: "image", target: "edit", targetHandle: "images" },
      ],
    });
    // The reference placed in the canvas becomes a reference of the shot.
    expect(db.select().from(schema.shots).where(eq(schema.shots.id, shot.id)).get()!.refIds).toEqual([ref.id]);
    const r = await runNode(shot.id, { nodeId: "edit" });
    expect(r.runs[0].prompt).toBe("Lina, manteau rouge. Lina attend sur le quai. Close-up on the face.");
    expect(r.runs[0].params.images).toHaveLength(1);
  });

  it("locked seed gives seed, seed+1… across variants", async () => {
    const { mk } = await makeShot("Seed");
    const shot = mk(0);
    const { writeGraph, runNode } = await import("./run");
    writeGraph(shot.id, {
      nodes: [
        { id: "t", type: "text", position: { x: 0, y: 0 }, data: { text: "Un phare" } },
        { id: "img", type: "imageGen", position: { x: 300, y: 0 }, data: { seedLocked: true, seed: 1000 } },
      ],
      edges: [{ id: "e1", source: "t", sourceHandle: "prompt", target: "img", targetHandle: "prompt" }],
    });
    const r = await runNode(shot.id, { nodeId: "img", variants: 3, confirmedCostUsd: 1 });
    expect(r.runs.map((x) => x.seed)).toEqual([1000, 1001, 1002]);
  });

  it("continuity template starts from the last frame of the previous shot's retained video", async () => {
    const { db, schema, mk } = await makeShot("Cont");
    const a = mk(0);
    const b = mk(1);
    const { writeGraph, runNode, sendToShot, insertTemplate } = await import("./run");
    writeGraph(a.id, {
      nodes: [
        { id: "t", type: "text", position: { x: 0, y: 0 }, data: { text: "Plan A" } },
        { id: "img", type: "imageGen", position: { x: 300, y: 0 }, data: {} },
        { id: "vid", type: "videoGen", position: { x: 600, y: 0 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "prompt", target: "img", targetHandle: "prompt" },
        { id: "e2", source: "img", sourceHandle: "image", target: "vid", targetHandle: "start" },
        { id: "e3", source: "t", sourceHandle: "prompt", target: "vid", targetHandle: "prompt" },
      ],
    });
    await runNode(a.id, { nodeId: "img" });
    await settle(a.id);
    const v = await runNode(a.id, { nodeId: "vid" });
    await settle(a.id);
    const take = sendToShot(v.runs[0].id);
    db.update(schema.shots).set({ selectedTakeId: take.id }).where(eq(schema.shots.id, a.id)).run();

    const g = insertTemplate(b.id, "continuity");
    const video = g.nodes.find((n) => n.type === "videoGen")!;
    const r = await runNode(b.id, { nodeId: video.id });
    expect(String(r.runs[0].params.image)).toMatch(/^mock:\/\/upload\//);
  }, 60_000);
});

describe("graphs from earlier versions", () => {
  it("drops links to ports that no longer exist, so the canvas stays editable", async () => {
    const { db, schema, mk } = await makeShot("Legacy");
    const shot = mk(0);
    const legacy = {
      nodes: [
        { id: "imageEdit-1", type: "imageEdit", position: { x: 0, y: 0 }, data: {} },
        { id: "take-1", type: "take", position: { x: 300, y: 0 }, data: { stage: "keyframe" } },
      ],
      edges: [{ id: "old", source: "imageEdit-1", sourceHandle: "image", target: "take-1", targetHandle: "in" }],
    };
    db.update(schema.shots).set({ graph: legacy }).where(eq(schema.shots.id, shot.id)).run();
    const { getCanvas, writeGraph } = await import("./run");
    const { graph } = getCanvas(shot.id);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);
    expect(() => writeGraph(shot.id, graph)).not.toThrow();
  });
});
