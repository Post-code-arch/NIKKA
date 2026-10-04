/**
 * npm run atlas:smoke
 *
 * 1 short LLM call, 1 text → image with the cheapest image model found,
 * then 1 image → video from that image. Models and parameters are taken
 * from the live Atlas catalog and each model's published input schema.
 *
 * Env:
 *   NIKKA_MOCK_ATLAS=1              run against the local mock
 *   NIKKA_LLM_MODEL                 LLM id (default: cheapest Text model)
 *   NIKKA_SMOKE_IMAGE_MODEL         force a t2i model id
 *   NIKKA_SMOKE_VIDEO_MODEL         force an i2v model id
 *   NIKKA_SMOKE_MAX_USD             abort if the estimate exceeds it (default 0.5)
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import {
  chat,
  downloadToAssets,
  generateImage,
  generateVideo,
  getModelInputSchema,
  isMockMode,
  listModels,
  predictionError,
  predictionOutputs,
  predictionState,
  unitPrice,
  uploadMedia,
  waitForPrediction,
  type CatalogModel,
  type ModelInputSchema,
} from "@/lib/atlas";
import {
  START_IMAGE_FIELDS,
  buildBody,
  findField,
  missingRequired,
  smallestValue,
} from "@/lib/atlas/schema-body";

const MAX_USD = Number(process.env.NIKKA_SMOKE_MAX_USD ?? "0.5");

function log(step: string, msg: string) {
  console.log(`[${step}] ${msg}`);
}

function byPrice(models: CatalogModel[]) {
  return models
    .map((m) => ({ m, price: unitPrice(m) }))
    .filter((x): x is { m: CatalogModel; price: NonNullable<ReturnType<typeof unitPrice>> } => x.price !== null)
    .sort((a, b) => a.price.usd - b.price.usd);
}

async function pickModel(
  label: string,
  forcedId: string | undefined,
  candidates: CatalogModel[],
  accept: (schema: ModelInputSchema) => boolean,
): Promise<{ model: CatalogModel; schema: ModelInputSchema }> {
  const list = forcedId ? candidates.filter((m) => m.model === forcedId) : candidates;
  if (forcedId && list.length === 0) throw new Error(`${label}: ${forcedId} not in the Atlas catalog`);
  for (const { m } of byPrice(list)) {
    try {
      const schema = await getModelInputSchema(m);
      if (accept(schema)) return { model: m, schema };
    } catch (err) {
      log(label, `skip ${m.model}: ${(err as Error).message}`);
    }
  }
  throw new Error(`${label}: no usable model found`);
}

function estimate(model: CatalogModel, seconds?: number): number {
  const p = unitPrice(model);
  if (!p) return NaN;
  return p.unit === "second" && seconds ? p.usd * seconds : p.usd;
}

async function runLlm(models: CatalogModel[]) {
  let id = process.env.NIKKA_LLM_MODEL;
  if (!id) {
    const llms = models
      .filter((m) => m.type === "Text")
      .map((m) => ({ m, out: Number(m.price?.actual?.output_price ?? m.price?.origin?.output_price ?? NaN) }))
      .filter((x) => Number.isFinite(x.out))
      .sort((a, b) => a.out - b.out);
    id = llms[0]?.m.model;
  }
  if (!id) throw new Error("llm: no Text model in catalog");
  log("llm", `model ${id}`);
  const res = await chat(
    [{ role: "user", content: "Réponds en un mot : quelle est la couleur du ciel par temps clair ?" }],
    { model: id, maxTokens: 50 },
  );
  log("llm", `→ ${JSON.stringify(res.text.trim())}`);
}

async function main() {
  console.log(`NIKKA atlas smoke — mode ${isMockMode() ? "MOCK" : "REAL"}\n`);
  const models = await listModels();
  log("catalog", `${models.length} models`);

  await runLlm(models);

  // --- Pick models from live schemas --------------------------------------
  const t2i = await pickModel(
    "t2i",
    process.env.NIKKA_SMOKE_IMAGE_MODEL,
    models.filter((m) => m.type === "Image" && !/edit|image-to|upscal|3d/i.test(m.model)),
    (s) => "prompt" in s.properties && missingRequired(s, { prompt: "x" }).length === 0,
  );
  const i2v = await pickModel(
    "i2v",
    process.env.NIKKA_SMOKE_VIDEO_MODEL,
    models.filter((m) => m.type === "Video" && /image-to-video/i.test(m.model)),
    (s) => {
      const f = findField(s, START_IMAGE_FIELDS);
      return !!f && missingRequired(s, { prompt: "x", [f]: "x" }).length === 0;
    },
  );

  const imageField = findField(i2v.schema, START_IMAGE_FIELDS)!;
  const videoParams: Record<string, unknown> = {
    prompt: "Slow dolly in, gentle light movement, cinematic",
  };
  for (const k of ["duration", "resolution"]) {
    const p = i2v.schema.properties[k];
    if (p) videoParams[k] = smallestValue(p);
  }
  const seconds = typeof videoParams.duration === "number" ? videoParams.duration : Number(videoParams.duration) || 5;

  const costImage = estimate(t2i.model);
  const costVideo = estimate(i2v.model, seconds);
  log("t2i", `${t2i.model.model} — ~$${costImage.toFixed(4)}`);
  log("i2v", `${i2v.model.model} (${imageField}, ${seconds}s) — ~$${costVideo.toFixed(4)}`);
  const total = costImage + costVideo;
  log("cost", `estimated total ~$${total.toFixed(4)} (cap $${MAX_USD})`);
  if (!(total <= MAX_USD)) throw new Error(`Estimated cost over NIKKA_SMOKE_MAX_USD, aborting before any paid call`);

  // --- Text → image ---------------------------------------------------------
  const imgBody = buildBody(t2i.model.model, t2i.schema, {
    prompt: "Storyboard keyframe: a lone lighthouse on a cliff at dusk, wide shot, cinematic",
  });
  const imgSub = await generateImage(imgBody);
  log("t2i", `prediction ${imgSub.predictionId}`);
  const imgPred = await waitForPrediction(imgSub.predictionId, {
    onUpdate: (d) => log("t2i", `status ${d.status}`),
  });
  if (predictionState(imgPred) !== "completed") throw new Error(`t2i failed: ${predictionError(imgPred)}`);
  const image = await downloadToAssets(predictionOutputs(imgPred)[0]);
  log("t2i", `stored ${image.path} (${image.bytes} B, sha256 ${image.sha256.slice(0, 12)}…)`);

  // --- Image → video --------------------------------------------------------
  // The stored local file is the source of truth: re-upload it rather than
  // reusing the temporary output URL.
  const imageUrl = await uploadMedia(image.absolutePath);
  log("upload", `→ ${imageUrl}`);
  const vidBody = buildBody(i2v.model.model, i2v.schema, { ...videoParams, [imageField]: imageUrl });
  const vidSub = await generateVideo(vidBody);
  log("i2v", `prediction ${vidSub.predictionId}`);
  const vidPred = await waitForPrediction(vidSub.predictionId, {
    onUpdate: (d) => log("i2v", `status ${d.status}`),
  });
  if (predictionState(vidPred) !== "completed") throw new Error(`i2v failed: ${predictionError(vidPred)}`);
  const video = await downloadToAssets(predictionOutputs(vidPred)[0]);
  log("i2v", `stored ${video.path} (${video.bytes} B, sha256 ${video.sha256.slice(0, 12)}…)`);

  console.log("\n✓ smoke test passed");
}

main().catch((err) => {
  console.error(`\n✗ smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
