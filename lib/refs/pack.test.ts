import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPackPrompt } from "./pack";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nikka-pack-"));
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

describe("pack prompts", () => {
  it("injects the descriptor verbatim, first (rule 7)", () => {
    const d = "Femme de 30 ans, cheveux noirs courts, manteau rouge.";
    const p = buildPackPrompt(d, "character", "face_34", 0, true);
    expect(p.startsWith(d)).toBe(true);
    expect(p).toMatch(/Three-quarter/);
    expect(p).toMatch(/same identity/);
  });

  it("varies repeated expressions", () => {
    const a = buildPackPrompt("x", "character", "expression", 0, false);
    const b = buildPackPrompt("x", "character", "expression", 1, false);
    expect(a).not.toBe(b);
  });
});

describe("pack pipeline (mock)", () => {
  it("generates candidates, keeps them, and validating adds the view to the variant", async () => {
    const { getDb, schema } = await import("@/db");
    const { launchPack, validateGeneration, regenerateView } = await import("./pack");
    const { pollDueJobs } = await import("@/lib/jobs/poller");
    const { storeAsset } = await import("@/lib/media/store");
    const { makeMockPng } = await import("@/lib/atlas/mock");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "P", settings: { defaultModels: {} } }).returning().get();
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "Lina", tag: "character", descriptor: "Lina." }).returning().get();
    const variant = db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale" }).returning().get();
    const source = await storeAsset(makeMockPng("123456"), "image/png", "src.png");

    const gens = await launchPack({
      referenceId: ref.id, variantId: variant.id, views: ["face_34", "full_body"],
      modelId: "mock/edit-multi-ref", sourceAssetId: source.id,
    });
    expect(gens.map((g) => g.status)).toEqual(["queued", "queued"]);
    expect(gens[0].params.images).toHaveLength(1);

    for (let i = 0; i < 50; i++) {
      await pollDueJobs(Date.now() + 60_000);
      const all = db.select().from(schema.refGenerations).where(eq(schema.refGenerations.referenceId, ref.id)).all();
      if (all.every((g) => g.status === "completed")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    validateGeneration(gens[0].id);
    const v = db.select().from(schema.referenceVariants).where(eq(schema.referenceVariants.id, variant.id)).get()!;
    expect(v.views.map((x) => x.view)).toEqual(["face_34"]);

    const again = await regenerateView(gens[1].id);
    expect(again.id).not.toBe(gens[1].id);
    expect(db.select().from(schema.refGenerations).where(eq(schema.refGenerations.referenceId, ref.id)).all()).toHaveLength(3);
  }, 30_000);

  it("refuses a text-only pack without descriptor, and the wrong model kind", async () => {
    const { getDb, schema } = await import("@/db");
    const { launchPack } = await import("./pack");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "Q", settings: { defaultModels: {} } }).returning().get();
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "X", tag: "character" }).returning().get();
    const variant = db.insert(schema.referenceVariants).values({ referenceId: ref.id, name: "Principale" }).returning().get();
    await expect(launchPack({ referenceId: ref.id, variantId: variant.id, views: ["face_front"], modelId: "mock/text-to-image" })).rejects.toThrow(/descripteur/);
    await expect(launchPack({ referenceId: ref.id, variantId: variant.id, views: ["face_front"], modelId: "mock/edit-multi-ref" })).rejects.toThrow(/texte → image/);
  });
});
