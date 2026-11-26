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
    expect(body).toEqual({ prompt: g.prompt, size: "1536x1024" });
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
    expect(e.mapInputs({ ...g, durationSec: 7.4 })).toEqual({ prompt: g.prompt, seed: 42, image: "s", duration: 7, aspect_ratio: "16:9" });
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

  it("LLM prices per million tokens", () => {
    const d = describeLlm(CatalogModelSchema.parse({ model: "deepseek-ai/deepseek-v4-flash", type: "Text", price: { actual: { input_price: "0.14", output_price: "0.28" } } }));
    expect(d).toMatchObject({ inputUsdPerM: 0.14, outputUsdPerM: 0.28 });
  });
});
