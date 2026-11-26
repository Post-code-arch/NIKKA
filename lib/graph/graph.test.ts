import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NODE_ORDER, NODE_SPECS, isValidEdge, sanitizeGraph, uniqueId, type CanvasGraph } from "./types";

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

const node = (id: string, type: CanvasGraph["nodes"][number]["type"], data = {}) => ({ id, type, position: { x: 0, y: 0 }, data });

describe("node types", () => {
  it("lists every node type, generators last", () => {
    expect(NODE_ORDER).toEqual(["text", "image", "video", "reference", "negative", "promptEnhancer", "textToImage", "textToVideo", "imageToVideo", "videoToVideo"]);
    expect(NODE_ORDER.filter((t) => NODE_SPECS[t].model)).toEqual(["textToImage", "textToVideo", "imageToVideo", "videoToVideo"]);
  });

  it("links only ports of the same type", () => {
    const g: CanvasGraph = { nodes: [node("t", "text"), node("i", "image"), node("v", "video"), node("i2v", "imageToVideo")], edges: [] };
    expect(isValidEdge(g, { source: "t", sourceHandle: "text", target: "i2v", targetHandle: "prompt" })).toBe(true);
    expect(isValidEdge(g, { source: "i", sourceHandle: "image", target: "i2v", targetHandle: "image" })).toBe(true);
    expect(isValidEdge(g, { source: "t", sourceHandle: "text", target: "i2v", targetHandle: "image" })).toBe(false);
    expect(isValidEdge(g, { source: "v", sourceHandle: "video", target: "i2v", targetHandle: "image" })).toBe(false);
  });

  it("drops nodes and links of earlier versions", () => {
    const g = sanitizeGraph({
      nodes: [node("t", "text"), { id: "old", type: "promptBuilder", position: { x: 0, y: 0 }, data: {} }, node("img", "textToImage")],
      edges: [
        { id: "a", source: "t", sourceHandle: "text", target: "img", targetHandle: "prompt" },
        { id: "b", source: "old", sourceHandle: "prompt", target: "img", targetHandle: "prompt" },
      ],
    });
    expect(g.nodes.map((n) => n.id)).toEqual(["t", "img"]);
    expect(g.edges.map((e) => e.id)).toEqual(["a"]);
  });

  it("never reuses node ids", () => {
    expect(uniqueId([{ id: "text-2" }], "text")).toBe("text-3");
  });
});

async function makeProject(name: string) {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  const project = db.insert(schema.projects).values({ name, settings: { defaultModels: {} } }).returning().get();
  return { db, schema, project };
}

async function settle(projectId: string) {
  const { getDb, schema } = await import("@/db");
  const { pollDueJobs } = await import("@/lib/jobs/poller");
  for (let i = 0; i < 100; i++) {
    await pollDueJobs(Date.now() + 60_000);
    const runs = getDb().select().from(schema.nodeRuns).where(eq(schema.nodeRuns.projectId, projectId)).all();
    if (runs.every((r) => r.status === "completed" || r.status === "failed")) return runs;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("runs never finished");
}

describe("project canvas (mock)", () => {
  it("lives without any sequence; text → image → video; results stay until sent to a shot", async () => {
    const { db, schema, project } = await makeProject("Free");
    const { getCanvas, writeGraph, runNode, sendToShot, estimateRun } = await import("./run");
    expect(getCanvas(project.id).graph.nodes).toHaveLength(0);

    writeGraph(project.id, {
      nodes: [
        node("t", "text", { text: "Un phare dans la tempête, gravure" }),
        node("img", "textToImage", { modelId: "mock/text-to-image" }),
        node("vid", "imageToVideo", { modelId: "mock/image-to-video" }),
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "text", target: "img", targetHandle: "prompt" },
        { id: "e2", source: "img", sourceHandle: "image", target: "vid", targetHandle: "image" },
        { id: "e3", source: "t", sourceHandle: "text", target: "vid", targetHandle: "prompt" },
      ],
    });

    // A batch always needs a confirmed total.
    const est = estimateRun(project.id, { nodeId: "img", variants: 4 });
    expect(est.needsConfirmation).toBe(true);
    await expect(runNode(project.id, { nodeId: "img", variants: 4 })).rejects.toThrow(/Confirmation/);
    const four = await runNode(project.id, { nodeId: "img", variants: 4, confirmedCostUsd: est.costEstimatedUsd });
    expect(four.runs).toHaveLength(4);
    expect(four.runs[0].prompt).toBe("Un phare dans la tempête, gravure"); // as written
    expect(four.runs[0].shotId).toBeNull();
    await settle(project.id);

    // Choose the third result: the video starts from it.
    const g = getCanvas(project.id).graph;
    g.nodes.find((n) => n.id === "img")!.data.selectedRunId = four.runs[2].id;
    writeGraph(project.id, g);
    const anim = await runNode(project.id, { nodeId: "vid" });
    const runs = await settle(project.id);
    expect(runs.find((r) => r.id === anim.runs[0].id)?.status).toBe("completed");
    expect(String(anim.runs[0].params.image)).toMatch(/^mock:\/\/upload\//);

    // Optional link to the storyboard: create a shot later and send the result to it.
    const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const shot = db.insert(schema.shots).values({ sequenceId: seq.id, order: 0, description: { value: "", origin: "validated" }, camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" } }).returning().get();
    const take = sendToShot(anim.runs[0].id, shot.id);
    expect(take.shotId).toBe(shot.id);
    expect(take.stage).toBe("video");
    expect(take.costEstimatedUsd).toBe(0); // already counted on the run
    expect(sendToShot(anim.runs[0].id, shot.id).id).toBe(take.id); // same shot: idempotent
  }, 60_000);

  it("text → video uses the node duration", async () => {
    const { project } = await makeProject("T2V");
    const { writeGraph, runNode } = await import("./run");
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "Vagues" }), node("v", "textToVideo", { durationSec: 10 })],
      edges: [{ id: "e", source: "t", sourceHandle: "text", target: "v", targetHandle: "prompt" }],
    });
    const r = await runNode(project.id, { nodeId: "v" });
    expect(r.runs[0].kind).toBe("video");
    expect(r.runs[0].params.duration).toBe(10);
    expect(r.estimate.unitCostUsd).toBeCloseTo(0.15);
  });

  it("image → video starts from an imported image; refuses without one", async () => {
    const { project } = await makeProject("I2V");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const photo = await storeAsset(makeMockPng("00aa00"), "image/png", "photo.png");
    const { writeGraph, runNode } = await import("./run");
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "Elle se retourne" }), node("v", "imageToVideo")],
      edges: [{ id: "e1", source: "t", sourceHandle: "text", target: "v", targetHandle: "prompt" }],
    });
    await expect(runNode(project.id, { nodeId: "v" })).rejects.toThrow(/image de départ/);
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "Elle se retourne" }), node("i", "image", { assetId: photo.id }), node("v", "imageToVideo")],
      edges: [
        { id: "e1", source: "t", sourceHandle: "text", target: "v", targetHandle: "prompt" },
        { id: "e2", source: "i", sourceHandle: "image", target: "v", targetHandle: "image" },
      ],
    });
    const r = await runNode(project.id, { nodeId: "v" });
    expect(String(r.runs[0].params.image)).toMatch(/^mock:\/\/upload\//);
  });

  it("prompt enhancer: LLM rewrites the text, the generator receives the enhanced prompt", async () => {
    const { project } = await makeProject("Enhance");
    const { writeGraph, runNode, enhanceNode, getCanvas } = await import("./run");
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "Un phare dans la tempête" }), node("e", "promptEnhancer", { target: "image" }), node("img", "textToImage")],
      edges: [
        { id: "e1", source: "t", sourceHandle: "text", target: "e", targetHandle: "prompt" },
        { id: "e2", source: "e", sourceHandle: "text", target: "img", targetHandle: "prompt" },
      ],
    });
    await expect(runNode(project.id, { nodeId: "img" })).rejects.toThrow(/pas encore été lancé/);
    const r = await enhanceNode(project.id, "e");
    expect(r.text.startsWith("Un phare dans la tempête")).toBe(true); // the original is kept
    expect(r.text.length).toBeGreaterThan("Un phare dans la tempête".length);
    expect(r.source).toBe("Un phare dans la tempête");
    expect(getCanvas(project.id).graph.nodes.find((n) => n.id === "e")!.data.text).toBe(r.text);
    const run = await runNode(project.id, { nodeId: "img" });
    expect(run.runs[0].prompt).toBe(r.text);
  });

  it("reference + negative: edit model picked, views as references, descriptor verbatim, negative sent", async () => {
    const { db, schema, project } = await makeProject("Refs");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const views = await Promise.all(["aa0000", "00aa00", "0000aa"].map((c, i) => storeAsset(makeMockPng(c), "image/png", `v${i}.png`)));
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "Lina", tag: "character", descriptor: "Lina, manteau rouge." }).returning().get();
    db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale", views: views.map((v) => ({ assetId: v.id, view: "face_front" as const })) }).run();
    const { writeGraph, runNode } = await import("./run");
    writeGraph(project.id, {
      nodes: [
        node("r", "reference", { referenceId: ref.id }),
        node("t", "text", { text: "attend sur le quai" }),
        node("n", "negative", { text: "flou, texte" }),
        node("img", "textToImage"),
      ],
      edges: [
        { id: "e1", source: "r", sourceHandle: "text", target: "img", targetHandle: "prompt" },
        { id: "e2", source: "t", sourceHandle: "text", target: "img", targetHandle: "prompt" },
        { id: "e3", source: "r", sourceHandle: "images", target: "img", targetHandle: "refs" },
        { id: "e4", source: "n", sourceHandle: "negative", target: "img", targetHandle: "negative" },
      ],
    });
    const r = await runNode(project.id, { nodeId: "img" });
    expect(r.estimate.modelId).toBe("mock/edit-multi-ref"); // references wired → edit model
    expect(r.runs[0].prompt).toBe("Lina, manteau rouge.\n\nattend sur le quai");
    expect(r.runs[0].params.images).toHaveLength(3);
    expect(r.runs[0].params.negative_prompt).toBe("flou, texte");
  });

  it("refuses inputs the chosen model does not accept", async () => {
    const { project } = await makeProject("Caps");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const a = await storeAsset(makeMockPng("123456"), "image/png", "a.png");
    const b = await storeAsset(makeMockPng("654321"), "image/png", "b.png");
    const { writeGraph, runNode } = await import("./run");
    const graph = (modelId: string) => ({
      nodes: [
        node("t", "text", { text: "Elle se retourne" }),
        node("s", "image", { assetId: a.id }),
        node("f", "image", { assetId: b.id }),
        node("n", "negative", { text: "flou" }),
        node("v", "imageToVideo", { modelId }),
      ],
      edges: [
        { id: "e1", source: "t", sourceHandle: "text", target: "v", targetHandle: "prompt" },
        { id: "e2", source: "s", sourceHandle: "image", target: "v", targetHandle: "image" },
        { id: "e3", source: "f", sourceHandle: "image", target: "v", targetHandle: "end" },
        { id: "e4", source: "n", sourceHandle: "negative", target: "v", targetHandle: "negative" },
      ],
    });
    writeGraph(project.id, graph("mock/image-to-video"));
    await expect(runNode(project.id, { nodeId: "v" })).rejects.toThrow(/prompt négatif/);
    writeGraph(project.id, graph("mock/image-to-video-pro"));
    const r = await runNode(project.id, { nodeId: "v" });
    expect(r.runs[0].params).toMatchObject({ negative_prompt: "flou" });
    expect(String(r.runs[0].params.end_image)).toMatch(/^mock:\/\/upload\//);
  });

  it("video → video: imported video as source, references and negative sent; refuses an image as source", async () => {
    const { project } = await makeProject("V2V");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockMp4, makeMockPng } = await import("@/lib/atlas/mock");
    const clip = await storeAsset(await makeMockMp4("224466"), "video/mp4", "clip.mp4");
    const face = await storeAsset(makeMockPng("664422"), "image/png", "face.png");
    const { writeGraph, runNode } = await import("./run");
    writeGraph(project.id, {
      nodes: [
        node("v", "video", { assetId: clip.id }),
        node("t", "text", { text: "La même scène, en hiver sous la neige" }),
        node("f", "image", { assetId: face.id }),
        node("n", "negative", { text: "flou" }),
        node("vv", "videoToVideo"),
      ],
      edges: [
        { id: "e1", source: "v", sourceHandle: "video", target: "vv", targetHandle: "video" },
        { id: "e2", source: "t", sourceHandle: "text", target: "vv", targetHandle: "prompt" },
        { id: "e3", source: "f", sourceHandle: "image", target: "vv", targetHandle: "refs" },
        { id: "e4", source: "n", sourceHandle: "negative", target: "vv", targetHandle: "negative" },
      ],
    });
    const r = await runNode(project.id, { nodeId: "vv" });
    expect(r.estimate.modelId).toBe("mock/video-to-video");
    expect(r.runs[0].kind).toBe("video");
    expect(String(r.runs[0].params.video)).toMatch(/^mock:\/\/upload\//);
    expect(r.runs[0].params.reference_images).toHaveLength(1);
    expect(r.runs[0].params.negative_prompt).toBe("flou");
    // An image cannot be a video source (ports refuse it; the engine double-checks).
    const g: CanvasGraph = { nodes: [node("f", "image"), node("vv", "videoToVideo")], edges: [] };
    expect(isValidEdge(g, { source: "f", sourceHandle: "image", target: "vv", targetHandle: "video" })).toBe(false);
  });

  it("a negative output cannot be wired into a prompt", () => {
    const g: CanvasGraph = { nodes: [node("n", "negative"), node("img", "textToImage")], edges: [] };
    expect(isValidEdge(g, { source: "n", sourceHandle: "negative", target: "img", targetHandle: "prompt" })).toBe(false);
    expect(isValidEdge(g, { source: "n", sourceHandle: "negative", target: "img", targetHandle: "negative" })).toBe(true);
  });

  it("prompt enhancer refuses an empty input", async () => {
    const { project } = await makeProject("Enhance vide");
    const { writeGraph, enhanceNode } = await import("./run");
    writeGraph(project.id, { nodes: [node("e", "promptEnhancer")], edges: [] });
    await expect(enhanceNode(project.id, "e")).rejects.toThrow(/Branche un node Texte/);
  });

  it("locked seed gives seed, seed+1… across variants", async () => {
    const { project } = await makeProject("Seed");
    const { writeGraph, runNode } = await import("./run");
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "Un phare" }), node("img", "textToImage", { seedLocked: true, seed: 1000 })],
      edges: [{ id: "e1", source: "t", sourceHandle: "text", target: "img", targetHandle: "prompt" }],
    });
    const r = await runNode(project.id, { nodeId: "img", variants: 3, confirmedCostUsd: 1 });
    expect(r.runs.map((x) => x.seed)).toEqual([1000, 1001, 1002]);
  });

  it("refuses to send a result to a shot of another project", async () => {
    const { db, schema, project } = await makeProject("A");
    const other = await makeProject("B");
    const { writeGraph, runNode, sendToShot } = await import("./run");
    writeGraph(project.id, {
      nodes: [node("t", "text", { text: "x" }), node("img", "textToImage")],
      edges: [{ id: "e1", source: "t", sourceHandle: "text", target: "img", targetHandle: "prompt" }],
    });
    const r = await runNode(project.id, { nodeId: "img" });
    await settle(project.id);
    const seq = db.insert(schema.sequences).values({ projectId: other.project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const shot = db.insert(schema.shots).values({ sequenceId: seq.id, order: 0, description: { value: "", origin: "validated" }, camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" } }).returning().get();
    expect(() => sendToShot(r.runs[0].id, shot.id)).toThrow(/autre projet/);
  });
});
