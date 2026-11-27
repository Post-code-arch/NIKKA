import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unitPrice } from "@/lib/atlas/catalog";
import { CatalogModelSchema, ModelInputSchemaSchema } from "@/lib/atlas/schemas";
import { estimateCostUsd, priceUnconfirmed } from "@/lib/cost/estimate";
import { describe as describeModel, entryFromDescriptor } from "./catalog-adapter";
import fixtures from "./fixtures/atlas-schemas.json";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-store-"));
  process.env.NIKKA_DB_PATH = path.join(dir, "nikka.db");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const descriptor = (id: string) => {
  const f = (fixtures as Record<string, { catalog: unknown; input: unknown }>)[id];
  const m = CatalogModelSchema.parse(f.catalog);
  return describeModel(m, ModelInputSchemaSchema.parse(f.input), unitPrice(m));
};

describe("learned prices per definition / quality", () => {
  it("a bill at another quality prices that quality only; a bill at the default sets the base price", async () => {
    const id = "openai/gpt-image-1.5/text-to-image";
    await writeFile(path.join(dir, "models.json"), JSON.stringify({ media: [descriptor(id), descriptor("bytedance/seedream-v5.0-lite/edit")], llm: [], observed: {} }));
    const { readStore, recordObservedPrice } = await import("./store");
    const entry = (x = id) => readStore().entries.find((e) => e.id === x)!;
    expect(priceUnconfirmed(entry(), "1K · medium")).toBe(true);

    recordObservedPrice(id, 0.04, { size: "1536x1024", quality: "high" });
    expect(entry().pricingByOption).toEqual({ "1K · high": 0.04 });
    expect(estimateCostUsd(entry(), { option: "1K · high" })).toBe(0.04);
    expect(entry().pricing.usd).toBe(0.003); // base (medium) unchanged
    expect(priceUnconfirmed(entry(), "1K · medium")).toBe(true);

    recordObservedPrice(id, 0.012, { size: "1536x1024", quality: "medium" });
    expect(entry().pricing.usd).toBe(0.012);
    expect(priceUnconfirmed(entry(), "1K · medium")).toBe(false);
    expect(priceUnconfirmed(entry(), "1K · low")).toBe(true);

    // A known real price can belong to one definition (Seedream was billed at 4K).
    const seedream = entry("bytedance/seedream-v5.0-lite/edit");
    expect(priceUnconfirmed(seedream, "4K")).toBe(false);
    expect(priceUnconfirmed(seedream, "2K")).toBe(true);
  });
});

describe("video editing that follows the source length", () => {
  it("Seedance-style duration -1: sends -1 and addresses @Video1 when editing a source video", () => {
    const m = CatalogModelSchema.parse({ model: "bytedance/seedance-x/reference-to-video", type: "Video", price: { actual: { base_price: "0.1" } } });
    const schema = ModelInputSchemaSchema.parse({
      properties: {
        prompt: { type: "string" },
        reference_videos: { type: "array", items: { type: "string" }, maxItems: 3 },
        duration: { type: "integer", enum: [-1, 4, 5, 6] },
      },
    });
    const d = describeModel(m, schema, unitPrice(m));
    expect(d.fields.duration).toEqual({ name: "duration", values: [4, 5, 6], auto: true });
    const body = entryFromDescriptor(d).mapInputs({ prompt: "change his clothes", sourceVideoUrl: "https://x/v.mp4", durationSec: 5 });
    expect(body).toMatchObject({ prompt: "Edit @Video1: change his clothes", reference_videos: ["https://x/v.mp4"], duration: -1 });
  });
});
