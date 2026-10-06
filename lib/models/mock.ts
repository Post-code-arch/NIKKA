import type { ModelEntry } from "./types";

/**
 * Models served by the local mock backend (lib/atlas/mock.ts). Their
 * parameter names mirror the mock schemas there.
 */
export const MOCK_MODELS: ModelEntry[] = [
  {
    id: "mock/text-to-image",
    label: "Mock · texte → image",
    kind: "t2i",
    supportsSeed: true,
    pricing: { unit: "image", usd: 0.003 },
    tier: "sketch",
    endpoint: "generateImage",
    mock: true,
    mapInputs: (g) => ({ prompt: g.prompt, ...(g.seed !== undefined ? { seed: g.seed } : {}) }),
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
    mapInputs: (g) => ({
      prompt: g.prompt,
      image: g.startImageUrl,
      duration: g.durationSec && g.durationSec > 5 ? 10 : 5,
    }),
  },
];
