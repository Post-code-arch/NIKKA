import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-transfer-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_DB_PATH = path.join(dir, "t.db");
  process.env.NIKKA_ASSETS_DIR = path.join(dir, "assets");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("project export / import", () => {
  it("round-trips a whole project, with new ids and its media, even after the original is gone", async () => {
    const { getDb, schema } = await import("@/db");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const { exportProject, importProject } = await import("./transfer");
    const db = getDb();
    const img = await storeAsset(makeMockPng("aa3355"), "image/png", "kf.png");
    const view = await storeAsset(makeMockPng("3355aa"), "image/png", "face.png");
    const res = await storeAsset(makeMockPng("55aa33"), "image/png", "run.png");

    const p = db.insert(schema.projects).values({ name: "Quai", settings: { defaultModels: {} } }).returning().get();
    const ref = db.insert(schema.references).values({ projectId: p.id, name: "Femme", tag: "character", descriptor: "Manteau sombre." }).returning().get();
    db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale", views: [{ assetId: view.id, view: "face_front" }] }).run();
    const seq = db.insert(schema.sequences).values({ projectId: p.id, order: 0, title: { value: "Arrivée", origin: "validated" }, summary: { value: "", origin: "validated" }, locationRefId: null }).returning().get();
    const shot = db
      .insert(schema.shots)
      .values({ sequenceId: seq.id, order: 0, description: { value: "Elle attend", origin: "validated" }, camera: { value: { scale: "close", angle: "eye_level", movement: "static" }, origin: "validated" }, refIds: [ref.id], framing: { [ref.id]: "left" } })
      .returning()
      .get();
    const kf = db.insert(schema.takes).values({ shotId: shot.id, stage: "keyframe", assetId: img.id, model: "m", prompt: "x", params: {}, status: "completed", costEstimatedUsd: 0.03, costActualUsd: 0.03 }).returning().get();
    db.insert(schema.takes).values({ shotId: shot.id, stage: "video", parentTakeId: kf.id, model: "m", prompt: "x", params: {}, status: "processing", costEstimatedUsd: 0.09 }).run();
    db.update(schema.shots).set({ selectedTakeId: kf.id }).where(eq(schema.shots.id, shot.id)).run();
    const run = db.insert(schema.nodeRuns).values({ projectId: p.id, nodeId: "img", kind: "image", model: "m", prompt: "x", params: {}, status: "completed", assetId: res.id, costEstimatedUsd: 0.02 }).returning().get();
    db.update(schema.projects)
      .set({
        canvas: {
          nodes: [
            { id: "r", type: "reference", position: { x: 0, y: 0 }, data: { referenceId: ref.id } },
            { id: "img", type: "textToImage", position: { x: 300, y: 0 }, data: { selectedRunId: run.id } },
          ],
          edges: [],
        },
        digest: { validatedLevel: 4, applied: { referenceIds: [ref.id], sequenceIds: [seq.id] } },
      })
      .where(eq(schema.projects.id, p.id))
      .run();

    const { fileName, data } = exportProject(p.id);
    expect(fileName).toBe("Quai.nikka.zip");

    // The original disappears, media included: the import must bring everything back.
    const files = [img, view, res].map((a) => path.resolve(a.path));
    db.delete(schema.projects).where(eq(schema.projects.id, p.id)).run();
    db.delete(schema.assets).run();
    await Promise.all(files.map((f) => rm(f, { force: true })));

    const imported = await importProject(data);
    expect(imported.name).toBe("Quai");
    expect(imported.id).not.toBe(p.id);

    const { getProjectTree } = await import("./queries");
    const tree = getProjectTree(imported.id)!;
    const nshot = tree.sequences[0].shots[0];
    const nref = tree.references[0];
    expect(tree.sequences[0].title.value).toBe("Arrivée");
    expect(nshot.id).not.toBe(shot.id);
    expect(nshot.refIds).toEqual([nref.id]);
    expect(nshot.framing).toEqual({ [nref.id]: "left" });
    const nkf = nshot.takes.find((t) => t.stage === "keyframe")!;
    const nvid = nshot.takes.find((t) => t.stage === "video")!;
    expect(nshot.selectedTakeId).toBe(nkf.id);
    expect(nvid.parentTakeId).toBe(nkf.id);
    expect(nvid.status).toBe("failed"); // was still running at export time
    const onDisk = (id: string) => existsSync(path.resolve(db.select().from(schema.assets).where(eq(schema.assets.id, id)).get()!.path));
    expect(onDisk(nkf.assetId!)).toBe(true);
    expect(onDisk(nref.variants[0].views[0].assetId)).toBe(true);

    const np = db.select().from(schema.projects).where(eq(schema.projects.id, imported.id)).get()!;
    const nodes = (np.canvas as { nodes: { id: string; data: Record<string, string> }[] }).nodes;
    const nrun = db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.projectId, imported.id)).get()!;
    expect(nodes.find((n) => n.id === "r")!.data.referenceId).toBe(nref.id);
    expect(nodes.find((n) => n.id === "img")!.data.selectedRunId).toBe(nrun.id);
    expect(onDisk(nrun.assetId!)).toBe(true);
    expect((np.digest as { applied: { sequenceIds: string[] } }).applied.sequenceIds).toEqual([tree.sequences[0].id]);

    // Importing again: a new copy, media reused (same content), name kept apart.
    const again = await importProject(data);
    expect(again.name).toBe("Quai (importé)");
    expect(db.select().from(schema.assets).all()).toHaveLength(3);
  });

  it("refuses a file that is not a NIKKA export", async () => {
    const { importProject } = await import("./transfer");
    await expect(importProject(new Uint8Array([1, 2, 3]))).rejects.toThrow(/export NIKKA/);
  });
});
