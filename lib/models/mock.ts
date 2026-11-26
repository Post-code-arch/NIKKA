import type { LlmDescriptor } from "./catalog-adapter";
import { optionFields, type ModelOptions } from "./options";
import type { ModelEntry } from "./types";

/** Mock output options, shaped like real schemas (sizes for images, resolution for videos). */
const MOCK_IMAGE_OPTIONS: ModelOptions = {
  sizes: {
    field: "size",
    default: "1024*1024",
    values: ["1024*1024", "1344*768", "768*1344", "2048*2048", "2688*1536", "1536*2688", "4096*4096", "4096*2304", "2304*4096"].map((v) => {
      const [w, h] = v.split("*").map(Number);
      return { value: v, w, h };
    }),
  },
  quality: { field: "quality", values: ["low", "medium", "high"], default: "medium" },
};
const MOCK_VIDEO_OPTIONS: ModelOptions = {
  format: { field: "aspect_ratio", values: ["16:9", "9:16", "1:1"], default: "16:9" },
  definition: { field: "resolution", values: ["480p", "720p", "1080p", "4k"], default: "720p" },
};

/**
 * Models served by the local mock backend (lib/atlas/mock.ts). Their
 * parameter names mirror the mock schemas there.
 */
/** Mock LLM (rule-based digester and enhancer, nothing billed). */
export const MOCK_LLMS: LlmDescriptor[] = [{ id: "mock/llm", label: "Mock · LLM", inputUsdPerM: 0, outputUsdPerM: 0 }];

export const MOCK_MODELS: ModelEntry[] = [
  {
    id: "mock/text-to-image",
    label: "Mock · texte → image",
    kind: "t2i",
    supportsSeed: true,
    supportsNegativePrompt: true,
    options: MOCK_IMAGE_OPTIONS,
    pricing: { unit: "image", usd: 0.003 },
    tier: "sketch",
    endpoint: "generateImage",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
      ...optionFields(MOCK_IMAGE_OPTIONS, g),
      ...(g.negativePrompt ? { negative_prompt: g.negativePrompt } : {}),
      ...(g.seed !== undefined ? { seed: g.seed } : {}),
    }),
  },
  {
    id: "mock/edit-multi-ref",
    label: "Mock · édition multi-références",
    kind: "i2i",
    maxReferenceImages: 4,
    supportsSeed: true,
    supportsNegativePrompt: true,
    pricing: { unit: "image", usd: 0.005 },
    tier: "quality",
    endpoint: "generateImage",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
      images: g.referenceImageUrls ?? [],
      ...(g.negativePrompt ? { negative_prompt: g.negativePrompt } : {}),
      ...(g.seed !== undefined ? { seed: g.seed } : {}),
    }),
  },
  {
    id: "mock/text-to-video",
    label: "Mock · texte → vidéo",
    kind: "t2v",
    durations: [5, 10],
    supportsSeed: true,
    pricing: { unit: "second", usd: 0.015 },
    tier: "draft",
    endpoint: "generateVideo",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
      ...(g.seed !== undefined ? { seed: g.seed } : {}),
    }),
  },
  {
    id: "mock/video-to-video",
    label: "Mock · vidéo → vidéo",
    kind: "v2v",
    maxReferenceImages: 4,
    supportsNegativePrompt: true,
    supportsSeed: true,
    durations: [5, 10],
    pricing: { unit: "second", usd: 0.02 },
    tier: "draft",
    endpoint: "generateVideo",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
      video: g.sourceVideoUrl,
      ...(g.referenceImageUrls?.length ? { reference_images: g.referenceImageUrls } : {}),
      ...(g.negativePrompt ? { negative_prompt: g.negativePrompt } : {}),
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
      ...(g.seed !== undefined ? { seed: g.seed } : {}),
    }),
  },
  {
    id: "mock/reference-to-video",
    label: "Mock · références → vidéo",
    kind: "r2v",
    maxReferenceImages: 4,
    maxReferenceVideos: 2,
    supportsSeed: true,
    durations: [5, 10],
    pricing: { unit: "second", usd: 0.02 },
    tier: "draft",
    endpoint: "generateVideo",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
      ...(g.referenceImageUrls?.length ? { reference_images: g.referenceImageUrls } : {}),
      ...((g.sourceVideoUrl || g.referenceVideoUrls?.length) ? { reference_videos: [...(g.sourceVideoUrl ? [g.sourceVideoUrl] : []), ...(g.referenceVideoUrls ?? [])].slice(0, 2) } : {}),
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
      ...(g.seed !== undefined ? { seed: g.seed } : {}),
    }),
  },
  {
    id: "mock/image-to-video",
    label: "Mock · image → vidéo",
    kind: "i2v",
    durations: [5, 10],
    pricing: { unit: "second", usd: 0.01 },
    tier: "draft",
    endpoint: "generateVideo",
    mock: true,
    options: MOCK_VIDEO_OPTIONS,
    // Deliberately limited, to exercise the « mouvement non supporté » warning.
    camera: {
      movements: ["static", "pan_left", "pan_right", "tilt_up", "tilt_down", "dolly_in", "dolly_out", "zoom_in", "zoom_out", "handheld"],
    },
    mapInputs: (g) => ({
      prompt: g.prompt,
      image: g.startImageUrl,
      ...optionFields(MOCK_VIDEO_OPTIONS, g),
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
    }),
  },
  {
    id: "mock/image-to-video-pro",
    label: "Mock · image → vidéo (pro)",
    kind: "i2v",
    supportsStartEndFrames: true,
    supportsNegativePrompt: true,
    durations: [5, 10],
    pricing: { unit: "second", usd: 0.02 },
    tier: "quality",
    endpoint: "generateVideo",
    mock: true,
    // All movements; shows a per-model wording override.
    camera: { phrases: { "movement.dolly_zoom": "vertigo effect (dolly zoom)" } },
    mapInputs: (g) => ({
      prompt: g.prompt,
      image: g.startImageUrl,
      ...(g.endImageUrl ? { end_image: g.endImageUrl } : {}),
      ...(g.negativePrompt ? { negative_prompt: g.negativePrompt } : {}),
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
    }),
  },
];
