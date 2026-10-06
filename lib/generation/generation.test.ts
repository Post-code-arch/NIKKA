import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-gen-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_MOCK_DELAY_MS = "30";
  process.env.NIKKA_ASSETS_DIR = path.join(dir, "assets");
  process.env.NIKKA_DB_PATH = path.join(dir, "test.db");
});

afterAll(async () => {
  const { stopPoller } = await import("@/lib/jobs/poller");
  stopPoller();
  await rm(dir, { recursive: true, force: true });
});

async function setup(threshold = 2) {
  const { getDb, schema } = await import("@/db");
  const db = getDb();
  const project = db.insert(schema.projects).values({ name: "T", settings: { defaultModels: {}, confirmThresholdUsd: threshold } }).returning().get();
  const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
  const shot = db.insert(schema.shots).values({
    sequenceId: seq.id, order: 0, durationSec: 5,
    description: { value: "Un phare", origin: "validated" },
    camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" },
  }).returning().get();
  return { db, schema, shot };
}

async function waitDone(takeId: string) {
  const { getDb, schema } = await import("@/db");
  const { pollDueJobs } = await import("@/lib/jobs/poller");
  for (let i = 0; i < 100; i++) {
    await pollDueJobs(Date.now() + 60_000);
    const t = getDb().select().from(schema.takes).where(eq(schema.takes.id, takeId)).get()!;
    if (t.status === "completed" || t.status === "failed") return t;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("take never finished");
}

describe("generation pipeline (mock)", () => {
  it("takes go queued → completed with a local asset, and are never overwritten", async () => {
    const { createTake } = await import("./service");
    const { db, schema, shot } = await setup();
    const t1 = await createTake({ shotId: shot.id, modelId: "mock/text-to-image", stage: "keyframe", prompt: "Un phare" });
    expect(t1.status).toBe("queued");
    expect(t1.costEstimatedUsd).toBeCloseTo(0.003);
    const done = await waitDone(t1.id);
    expect(done.status).toBe("completed");
    expect(done.costActualUsd).toBeCloseTo(0.003);
    const asset = db.select().from(schema.assets).where(eq(schema.assets.id, done.assetId!)).get()!;
    expect(existsSync(path.resolve(asset.path))).toBe(true);
    expect(asset.width).toBeGreaterThan(0);

    const t2 = await createTake({ shotId: shot.id, modelId: "mock/text-to-image", stage: "keyframe", prompt: "Un phare" });
    expect(t2.id).not.toBe(t1.id);
    expect(db.select().from(schema.takes).where(eq(schema.takes.shotId, shot.id)).all()).toHaveLength(2);

    const video = await createTake({ shotId: shot.id, modelId: "mock/image-to-video", stage: "video", prompt: "travelling avant", parentTakeId: t1.id });
    const vdone = await waitDone(video.id);
    expect(vdone.status).toBe("completed");
    expect(vdone.costEstimatedUsd).toBeCloseTo(0.05); // 0.01 $/s × 5 s
    expect(db.select().from(schema.shots).where(eq(schema.shots.id, shot.id)).get()!.status).toBe("to_review");
  }, 30_000);

  it("refuses to launch above the threshold without confirmation", async () => {
    const { createTake, GenerationError } = await import("./service");
    const { shot } = await setup(0.001);
    await expect(
      createTake({ shotId: shot.id, modelId: "mock/text-to-image", stage: "keyframe", prompt: "x" }),
    ).rejects.toBeInstanceOf(GenerationError);
    const ok = await createTake({ shotId: shot.id, modelId: "mock/text-to-image", stage: "keyframe", prompt: "x", confirmedCostUsd: 0.003 });
    expect(ok.status).toBe("queued");
  });
});
