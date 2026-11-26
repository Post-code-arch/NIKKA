import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("spending cap", () => {
  it("counts real generations (not mock, not failed submissions) and LLM calls, and stops above the cap", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nikka-cap-"));
    process.env.NIKKA_DB_PATH = path.join(dir, "t.db");
    process.env.NIKKA_SPEND_CAP_USD = "0.10";
    const { getDb, schema } = await import("@/db");
    const { assertUnderCap, recordLlmSpend, spentUsd } = await import("./budget");
    const db = getDb();
    const p = db.insert(schema.projects).values({ name: "Cap", settings: { defaultModels: {} } }).returning().get();
    const run = (model: string, usd: number, status: "queued" | "failed", predictionId?: string) =>
      db.insert(schema.nodeRuns).values({ projectId: p.id, nodeId: "n", kind: "image", model, prompt: "x", params: {}, status, costEstimatedUsd: usd, predictionId }).run();
    run("mock/text-to-image", 5, "queued"); // mock: free
    run("openai/gpt-image-1.5/text-to-image", 5, "failed"); // never submitted: not billed
    run("openai/gpt-image-1.5/text-to-image", 0.04, "queued");
    recordLlmSpend({ model: "deepseek", usd: 0.01 });
    expect(await spentUsd()).toBeCloseTo(0.05);
    await expect(assertUnderCap("x")).resolves.toBeUndefined();
    run("bytedance/seedance", 0.06, "queued"); // the call being checked
    await expect(assertUnderCap("seedance")).rejects.toThrow(/Plafond de dépense atteint/);
    delete process.env.NIKKA_SPEND_CAP_USD;
  });
});
