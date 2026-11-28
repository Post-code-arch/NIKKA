import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-budget-"));
  process.env.NIKKA_DB_PATH = path.join(dir, "test.db");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("project budget", () => {
  it("counts the project's real takes and refuses what would go above its budget", async () => {
    const { getDb, schema } = await import("@/db");
    const { projectBudgetRefusal, projectSpentUsd } = await import("./budget");
    const db = getDb();
    const make = (name: string) => {
      const project = db.insert(schema.projects).values({ name, settings: { defaultModels: {}, budgetUsd: 4 } }).returning().get();
      const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
      const shot = db.insert(schema.shots).values({
        sequenceId: seq.id, order: 0, durationSec: 3,
        description: { value: "x", origin: "validated" },
        camera: { value: { scale: "wide", angle: "eye_level", movement: "static" }, origin: "validated" },
      }).returning().get();
      return { project, shot };
    };
    const a = make("A");
    const b = make("B");
    const take = (shotId: string, model: string, usd: number, status: "completed" | "failed" = "completed", predictionId: string | null = "p") =>
      db.insert(schema.takes).values({ shotId, stage: "keyframe", model, prompt: "x", params: {}, status, predictionId, costEstimatedUsd: usd, costActualUsd: status === "completed" ? usd : null }).run();
    take(a.shot.id, "real/model", 3);
    take(a.shot.id, "mock/text-to-image", 10); // mock: free
    take(a.shot.id, "real/model", 5, "failed", null); // never submitted: not billed
    take(a.shot.id, "real/model", 0.7, "failed", "p2"); // failed upstream, not charged
    take(b.shot.id, "real/model", 2); // another project
    expect(await projectSpentUsd(a.project.id)).toBe(3);
    expect(await projectBudgetRefusal(a.project.id, 4, 0.9)).toBeNull();
    expect(await projectBudgetRefusal(a.project.id, 4, 1.5)).toMatch(/Budget du projet atteint/);
    expect(await projectBudgetRefusal(a.project.id, undefined, 100)).toBeNull();
  });
});
