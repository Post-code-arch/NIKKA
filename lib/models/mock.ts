import type { LlmDescriptor } from "./catalog-adapter";
import type { ModelEntry } from "./types";

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
    pricing: { unit: "image", usd: 0.003 },
    tier: "sketch",
    endpoint: "generateImage",
    mock: true,
    mapInputs: (g) => ({
      prompt: g.prompt,
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
    id: "mock/image-to-video",
    label: "Mock · image → vidéo",
    kind: "i2v",
    durations: [5, 10],
    pricing: { unit: "second", usd: 0.01 },
    tier: "draft",
    endpoint: "generateVideo",
    mock: true,
    // Deliberately limited, to exercise the « mouvement non supporté » warning.
    camera: {
      movements: ["static", "pan_left", "pan_right", "tilt_up", "tilt_down", "dolly_in", "dolly_out", "zoom_in", "zoom_out", "handheld"],
    },
    mapInputs: (g) => ({
      prompt: g.prompt,
      image: g.startImageUrl,
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
