import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-sb-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_MOCK_DELAY_MS = "10";
  process.env.NIKKA_DB_PATH = path.join(dir, "t.db");
  process.env.NIKKA_ASSETS_DIR = path.join(dir, "assets");
});
afterAll(async () => {
  (await import("@/lib/jobs/poller")).stopPoller();
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const { getDb, schema } = await import("@/db");
  const ops = await import("./ops");
  const db = getDb();
  const project = db.insert(schema.projects).values({ name: "SB", settings: { defaultModels: {} } }).returning().get();
  const seq = (order: number) =>
    db.insert(schema.sequences).values({ projectId: project.id, order, title: { value: `S${order}`, origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
  const a = seq(0);
  const b = seq(1);
  const shots = ["un", "deux", "trois"].map((d) => ops.insertShot(a.id, { description: d, durationSec: 4 }));
  const order = (seqId: string) =>
    db.select().from(schema.shots).where(eq(schema.shots.sequenceId, seqId)).orderBy(asc(schema.shots.order)).all().map((s) => s.description.value);
  return { db, schema, ops, a, b, shots, order };
}

describe("storyboard ops", () => {
  it("reorders, moves across sequences, inserts between, splits", async () => {
    const { ops, a, b, shots, order, db, schema } = await setup();
    ops.moveShot(shots[2].id, a.id, 0);
    expect(order(a.id)).toEqual(["trois", "un", "deux"]);
    ops.moveShot(shots[0].id, b.id, 0);
    expect(order(a.id)).toEqual(["trois", "deux"]);
    expect(order(b.id)).toEqual(["un"]);
    ops.insertShot(a.id, { index: 1, description: "entre" });
    expect(order(a.id)).toEqual(["trois", "entre", "deux"]);
    const second = ops.splitShot(shots[1].id);
    expect(order(a.id)).toEqual(["trois", "entre", "deux", "deux"]);
    const durations = [shots[1].id, second.id].map((id) => db.select().from(schema.shots).where(eq(schema.shots.id, id)).get()!.durationSec);
    expect(durations).toEqual([2, 2]);
  });

  it("batch: sketch then keyframes then video, total confirmed, video only where a keyframe exists", async () => {
    const { ops, shots, db, schema } = await setup();
    const ids = shots.map((s) => s.id);
    const plan = ops.planBatch(ids, "sketch");
    expect(plan.count).toBe(3);
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.items[0].prompt).toMatch(/pencil storyboard sketch/);
    await expect(ops.launchBatch(ids, "sketch")).rejects.toThrow(/Confirmation du coût total/);
    const r = await ops.launchBatch(ids, "sketch", plan.totalUsd);
    expect(r.results.every((x) => x.takeId)).toBe(true);
    expect(db.select().from(schema.takes).all().filter((t) => ids.includes(t.shotId)).every((t) => t.stage === "sketch")).toBe(true);

    // Before any finished image, nothing to animate.
    const video = ops.planBatch(ids, "video");
    expect(video.count).toBe(0);
    expect(video.items.every((i) => i.skipped)).toBe(true);

    const { pollDueJobs } = await import("@/lib/jobs/poller");
    for (let i = 0; i < 50; i++) {
      await pollDueJobs(Date.now() + 60_000);
      if (db.select().from(schema.takes).all().filter((t) => ids.includes(t.shotId)).every((t) => t.status === "completed")) break;
      await new Promise((res) => setTimeout(res, 20));
    }
    // A sketch is not animated: keyframes first.
    expect(ops.planBatch(ids, "video").count).toBe(0);
    const kf = ops.planBatch([ids[0]], "keyframe");
    expect(kf.needsConfirmation).toBe(false); // one shot under the threshold
    const k = ops.planBatch(ids, "keyframe");
    await ops.launchBatch(ids, "keyframe", k.totalUsd);
    for (let i = 0; i < 50; i++) {
      await pollDueJobs(Date.now() + 60_000);
      if (db.select().from(schema.takes).all().filter((t) => ids.includes(t.shotId)).every((t) => t.status === "completed")) break;
      await new Promise((res) => setTimeout(res, 20));
    }
    const v = ops.planBatch(ids, "video");
    expect(v.count).toBe(3);
    expect(v.items.every((i) => i.parentTakeId)).toBe(true);
    // 4 s shots, model accepting 5 or 10 s: the estimate counts the 5 s really produced…
    expect(v.items[0].costEstimatedUsd).toBeCloseTo(0.05);
    // …and the shot's duration is sent (it was missing before).
    const r = await ops.launchBatch([ids[0]], "video", 1);
    const take = db.select().from(schema.takes).all().find((t) => t.id === r.results[0].takeId)!;
    expect(take.params.duration).toBe(5);
  }, 30_000);
});
