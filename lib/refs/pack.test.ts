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

describe("shot prompt preview (mock)", () => {
  it("updates with scale and movement, selects views, and flags unsupported moves", async () => {
    const { getDb, schema } = await import("@/db");
    const { shotPromptPreview } = await import("@/lib/prompt/shot");
    const db = getDb();
    const project = db.insert(schema.projects).values({ name: "S", settings: { defaultModels: {} } }).returning().get();
    const ref = db.insert(schema.references).values({ projectId: project.id, name: "Lina", tag: "character", descriptor: "Femme au manteau rouge." }).returning().get();
    db.insert(schema.referenceVariants).values({
      referenceId: ref.id, name: "Principale",
      views: [{ assetId: "a1", view: "face_front" }, { assetId: "a2", view: "full_body" }],
    }).run();
    const seq = db.insert(schema.sequences).values({ projectId: project.id, order: 0, title: { value: "S", origin: "validated" }, summary: { value: "", origin: "validated" } }).returning().get();
    const shot = db.insert(schema.shots).values({
      sequenceId: seq.id, order: 0, refIds: [ref.id],
      description: { value: "Lina attend sur le quai", origin: "validated" },
      camera: { value: { scale: "close", angle: "eye_level", movement: "orbit_left" }, origin: "validated" },
    }).returning().get();

    const models = { keyframe: "mock/edit-multi-ref", video: "mock/image-to-video" };
    const close = shotPromptPreview(shot.id, models)!;
    expect(close.keyframe.prompt).toBe("Femme au manteau rouge. Lina attend sur le quai. Close-up shot.");
    expect(close.video.prompt).toMatch(/orbits around the subject/);
    expect(close.references!.picked.map((p) => p.view)).toEqual(["face_front"]);
    expect(close.movement.supported).toBe(false);
    expect(close.movement.alternatives.map((a) => a.id)).toEqual(["mock/image-to-video-pro"]);

    db.update(schema.shots).set({ camera: { value: { scale: "wide", angle: "eye_level", movement: "dolly_in", speed: "slow" }, origin: "validated" } }).where(eq(schema.shots.id, shot.id)).run();
    const wide = shotPromptPreview(shot.id, models)!;
    expect(wide.keyframe.prompt).toMatch(/Wide shot\./);
    expect(wide.video.prompt).toMatch(/dollies in toward the subject, slow and smooth/);
    expect(wide.references!.picked.map((p) => p.view)).toEqual(["full_body"]);
    expect(wide.movement.supported).toBe(true);
  });
});
