import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadToAssets } from "./download";
import { generateImage } from "./generate";
import { getPrediction, predictionOutputs, predictionState, waitForPrediction } from "./poll";
import { buildBody, smallestValue } from "./schema-body";
import { PredictionDataSchema } from "./schemas";

describe("prediction helpers", () => {
  it("maps statuses", () => {
    const p = (status: string) => PredictionDataSchema.parse({ status });
    expect(predictionState(p("completed"))).toBe("completed");
    expect(predictionState(p("succeeded"))).toBe("completed");
    expect(predictionState(p("failed"))).toBe("failed");
    expect(predictionState(p("processing"))).toBe("pending");
    expect(predictionState(p("created"))).toBe("pending");
  });

  it("collects outputs in every shape", () => {
    const d = PredictionDataSchema.parse({ status: "completed", outputs: ["a", { url: "b" }] });
    expect(predictionOutputs(d)).toEqual(["a", "b"]);
    const d2 = PredictionDataSchema.parse({ status: "completed", output: "c" });
    expect(predictionOutputs(d2)).toEqual(["c"]);
  });
});

describe("schema body", () => {
  const schema = {
    required: ["prompt", "size"],
    properties: {
      prompt: { type: "string" },
      size: { type: "string", default: "1024*1024" },
      duration: { type: "integer", enum: [10, 5, 8] },
    },
  };
  it("fills required defaults and rejects unknown params", () => {
    expect(buildBody("m", schema, { prompt: "x" })).toEqual({ model: "m", prompt: "x", size: "1024*1024" });
    expect(() => buildBody("m", schema, { prompt: "x", image_url: "y" })).toThrow(/not in schema/);
    expect(() => buildBody("m", { ...schema, required: ["prompt"] }, {})).toThrow(/missing required/);
  });
  it("picks the smallest enum value", () => {
    expect(smallestValue(schema.properties.duration)).toBe(5);
    expect(smallestValue({ enum: ["1080p", "480p", "720p"] })).toBe("480p");
  });
});

describe("mock mode end to end", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "nikka-test-"));
    process.env.NIKKA_MOCK_ATLAS = "1";
    process.env.NIKKA_MOCK_DELAY_MS = "50";
    process.env.NIKKA_ASSETS_DIR = dir;
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("submits, polls, downloads and hashes an image", async () => {
    const sub = await generateImage({ model: "mock/text-to-image", prompt: "x" });
    expect(predictionState(await getPrediction(sub.predictionId))).toBe("pending");
    const done = await waitForPrediction(sub.predictionId, { initialIntervalMs: 20 });
    expect(predictionState(done)).toBe("completed");
    const file = await downloadToAssets(predictionOutputs(done)[0]);
    expect(file.kind).toBe("image");
    expect(file.absolutePath.startsWith(dir)).toBe(true);
    const bytes = await readFile(file.absolutePath);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(path.basename(file.absolutePath)).toBe(`${file.sha256}.png`);
  });
});
