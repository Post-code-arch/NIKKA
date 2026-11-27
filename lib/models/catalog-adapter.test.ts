import { describe as group, expect, it } from "vitest";
import { unitPrice } from "@/lib/atlas/catalog";
import { CatalogModelSchema, ModelInputSchemaSchema } from "@/lib/atlas/schemas";
import { classify, describe, describeLlm, entryFromDescriptor } from "./catalog-adapter";
import fixtures from "./fixtures/atlas-schemas.json";

/** Real Atlas schemas (catalog + Input), saved on 2026-11-26. */
function load(id: string) {
  const f = (fixtures as Record<string, { catalog: unknown; input: unknown }>)[id];
  const m = CatalogModelSchema.parse(f.catalog);
  return { m, schema: ModelInputSchemaSchema.parse(f.input), price: unitPrice(m) };
}
const build = (id: string) => {
  const { m, schema, price } = load(id);
  return describe(m, schema, price);
};
const g = { prompt: "Un phare dans la tempête", seed: 42, durationSec: 5, referenceImageUrls: ["u1", "u2"], startImageUrl: "s", endImageUrl: "e" };

group("catalog adapter (real schemas)", () => {
  it("classifies catalog entries", () => {
    expect(classify({ model: "openai/gpt-image-1.5/text-to-image", type: "Image" })).toBe("t2i");
    expect(classify({ model: "black-forest-labs/flux-2-pro/edit", type: "Image" })).toBe("i2i");
    expect(classify({ model: "kwaivgi/kling-v2.5-turbo-pro/image-to-video", type: "Video" })).toBe("i2v");
    expect(classify({ model: "bytedance/seedance-v1-pro-fast/text-to-video", type: "Video" })).toBe("t2v");
    expect(classify({ model: "deepseek-ai/deepseek-v4-flash", type: "Text" })).toBe("llm");
  });

  it("text → image: only schema fields, landscape size", () => {
    const d = build("openai/gpt-image-1.5/text-to-image");
    expect(d.kind).toBe("t2i");
    expect(d.tier).toBe("sketch");
    expect(d.pricing).toMatchObject({ unit: "image", usd: 0.003 });
    const body = entryFromDescriptor(d).mapInputs(g);
    expect(body).toEqual({ prompt: g.prompt, size: "1536x1024", quality: "medium" });
  });

  it("multi-reference edit: images array capped by maxItems, seed, size w*h", () => {
    const d = build("black-forest-labs/flux-2-pro/edit");
    const e = entryFromDescriptor(d);
    expect(e.maxReferenceImages).toBe(8);
    expect(e.mapInputs(g)).toEqual({ prompt: g.prompt, seed: 42, images: ["u1", "u2"] });
  });

  it("image → video: start image, duration snapped to the enum, 16:9", () => {
    const e = entryFromDescriptor(build("bytedance/seedance-v1-pro-fast/image-to-video"));
    expect(e.durations).toContain(5);
    expect(e.mapInputs({ ...g, durationSec: 7.4 })).toEqual({ prompt: g.prompt, seed: 42, image: "s", duration: 7, aspect_ratio: "16:9", resolution: "480p" });
    expect(e.pricing.unit).toBe("second"); // no unit in the catalog: the cautious one
  });

  it("start + end frames when the schema has them; audio off", () => {
    const kling = entryFromDescriptor(build("kwaivgi/kling-v2.5-turbo-pro/image-to-video"));
    expect(kling.supportsStartEndFrames).toBe(true);
    expect(kling.mapInputs(g)).toEqual({ prompt: g.prompt, image: "s", last_image: "e", duration: 5 });
    const seed25 = entryFromDescriptor(build("bytedance/seedance-2.5-flash/image-to-video"));
    expect(seed25.mapInputs(g)).toMatchObject({ image: "s", last_image: "e", generate_audio: false, duration: 5 });
  });

  it("other field names (image_url, no duration field)", () => {
    const ltx = entryFromDescriptor(build("ltx-2.3-quality/image-to-video"));
    expect(ltx.mapInputs(g)).toEqual({ prompt: g.prompt, seed: 42, image_url: "s", generate_audio: false });
    expect(ltx.durations).toBeUndefined();
  });

  it("video → video: source video field by name, optional references, negative, duration", () => {
    expect(classify({ model: "alibaba/wan-2.6/video-to-video", type: "Video" })).toBe("v2v");
    expect(classify({ model: "kwaivgi/kling-v4.0-flash/video-edit", type: "Video" })).toBe("v2v");
    expect(classify({ model: "sonilo/v1.1/video-to-video-music", type: "Video" })).toBeNull();
    const gv = { prompt: "en hiver", sourceVideoUrl: "v", referenceImageUrls: ["r1"], negativePrompt: "flou", durationSec: 5, seed: 7 };
    const wan = entryFromDescriptor(build("alibaba/wan-2.6/video-to-video"));
    expect(wan.kind).toBe("v2v");
    expect(wan.mapInputs(gv)).toMatchObject({ videos: ["v"], negative_prompt: "flou", duration: 5, seed: 7, size: "1280*720" });
    const flux = entryFromDescriptor(build("black-forest-labs/flux-3/edit-video"));
    expect(flux.mapInputs(gv)).toEqual({ prompt: "en hiver", video_url: "v" });
    const kling = entryFromDescriptor(build("kwaivgi/kling-v4.0-flash/video-edit"));
    expect(kling.maxReferenceImages).toBe(10);
    expect(kling.mapInputs(gv)).toMatchObject({ video: "v", reference_images: ["r1"], duration: 5 });
    const gemini = entryFromDescriptor(build("google/gemini-omni-1.2-flash/video-edit"));
    expect(gemini.mapInputs(gv)).toMatchObject({ video: "v", reference_images: ["r1"], seed: 7 });
  });

  it("references → video: Seedance 2 takes images and videos; MiniMax one mixed list; old Seedance names", () => {
    expect(classify({ model: "bytedance/seedance-2.0/reference-to-video", type: "Video" })).toBe("r2v");
    expect(classify({ model: "bytedance/seedance-v1-pro-t2v-480p", type: "Video" })).toBe("t2v");
    expect(classify({ model: "bytedance/seedance-v1-pro-i2v-720p", type: "Video" })).toBe("i2v");
    const g = { prompt: "la femme de image 1 marche", referenceImageUrls: ["i1", "i2"], referenceVideoUrls: ["v1"], durationSec: 6, seed: 3 };
    const seedance = entryFromDescriptor(build("bytedance/seedance-2.0/reference-to-video"));
    expect(seedance.kind).toBe("r2v");
    expect([seedance.maxReferenceImages, seedance.maxReferenceVideos]).toEqual([9, 3]);
    expect(seedance.mapInputs(g)).toMatchObject({ reference_images: ["i1", "i2"], reference_videos: ["v1"], duration: 6, seed: 3, ratio: "16:9", generate_audio: false });
    // Used by the Video → video node: the source video becomes the first reference video.
    expect(seedance.mapInputs({ prompt: "en hiver", sourceVideoUrl: "src" })).toMatchObject({ reference_videos: ["src"] });
    const flash = entryFromDescriptor(build("bytedance/seedance-2.5-flash/reference-to-video"));
    expect(flash.maxReferenceVideos).toBe(5);
    const minimax = entryFromDescriptor(build("minimax/h3/reference-to-video"));
    expect(minimax.mapInputs(g)).toMatchObject({ refers: ["i1", "i2", "v1"] });
    const kling = entryFromDescriptor(build("kwaivgi/kling-v4.0-flash/reference-to-video"));
    expect(kling.mapInputs(g)).toMatchObject({ reference_images: ["i1", "i2"], reference_videos: ["v1"] });
  });

  it("output options: formats, 1K/2K/4K from image sizes, video definitions, quality", async () => {
    const { choicesOf, optionKey, definitionLabel } = await import("./options");
    const seedream = entryFromDescriptor(build("bytedance/seedream-v5.0-lite/edit"));
    const c = choicesOf(seedream.options);
    expect(c.definitions).toEqual(["2K", "4K"]);
    expect(c.formats).toContain("16:9");
    expect(c.formats).toContain("9:16");
    expect(c.defaults).toMatchObject({ aspectRatio: "16:9", resolution: "2K" });
    expect(seedream.mapInputs({ prompt: "x", referenceImageUrls: ["u"] }).size).toBe("2848*1600");
    expect(seedream.mapInputs({ prompt: "x", referenceImageUrls: ["u"], resolution: "4K", aspectRatio: "9:16" }).size).toBe("2304*4096");
    expect(optionKey(seedream.options, { resolution: "4K" })).toBe("4K");

    const gpt = entryFromDescriptor(build("openai/gpt-image-1.5/text-to-image"));
    expect(choicesOf(gpt.options)).toMatchObject({ formats: ["3:2", "1:1", "2:3"], qualities: ["low", "medium", "high"], defaults: { aspectRatio: "3:2", quality: "medium" } });
    expect(gpt.mapInputs({ prompt: "x", aspectRatio: "2:3", quality: "high" })).toEqual({ prompt: "x", size: "1024x1536", quality: "high" });

    const seedance = entryFromDescriptor(build("bytedance/seedance-2.0/reference-to-video"));
    const v = choicesOf(seedance.options);
    expect(v.definitions.slice(0, 2)).toEqual(["480p", "720p"]);
    expect(v.definitions).toContain("4k");
    expect(definitionLabel("1080p-esr")).toBe("1080p (upscalé +)");
    expect(definitionLabel("720p-sr")).toBe("720p (upscalé)");
    expect(seedance.mapInputs({ prompt: "x", referenceImageUrls: ["i"], resolution: "1080p", aspectRatio: "9:16" })).toMatchObject({ resolution: "1080p", ratio: "9:16" });
    // A choice the model does not offer falls back to its default.
    expect(seedance.mapInputs({ prompt: "x", referenceImageUrls: ["i"], resolution: "8K" })).toMatchObject({ resolution: "720p" });
    // LTX "resolution" holds named formats, not definitions: left alone.
    expect(entryFromDescriptor(build("ltx-2.3-quality/image-to-video")).options?.definition).toBeUndefined();
  });

  it("LLM prices per million tokens", () => {
    const d = describeLlm(CatalogModelSchema.parse({ model: "deepseek-ai/deepseek-v4-flash", type: "Text", price: { actual: { input_price: "0.14", output_price: "0.28" } } }));
    expect(d).toMatchObject({ inputUsdPerM: 0.14, outputUsdPerM: 0.28 });
  });
});
