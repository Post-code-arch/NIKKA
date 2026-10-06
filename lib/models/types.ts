import type { CameraMovement } from "./camera-capabilities";

export type ModelKind = "t2i" | "i2i" | "t2v" | "i2v" | "llm";
export type ModelTier = "sketch" | "draft" | "quality";

/** NIKKA-side inputs, mapped to each model's own schema by `mapInputs`. */
export interface GenericInputs {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /** Temporary Atlas URLs (uploaded just before submission). */
  referenceImageUrls?: string[];
  startImageUrl?: string;
  endImageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
}

export interface CameraCapabilities {
  /** Movements the model handles reliably; others raise a warning (phase 3). */
  movements?: CameraMovement[];
}

/** PRD §4. Every entry must be verified against the model's published schema. */
export interface ModelEntry {
  id: string;
  label: string;
  kind: ModelKind;
  maxReferenceImages?: number;
  supportsStartEndFrames?: boolean;
  supportsSeed?: boolean;
  durations?: number[];
  resolutions?: string[];
  pricing: { unit: "image" | "second" | "request"; usd: number };
  tier: ModelTier;
  /** Atlas endpoint used to submit the generation. */
  endpoint: "generateImage" | "generateVideo";
  mapInputs: (generic: GenericInputs) => Record<string, unknown>;
  camera?: CameraCapabilities;
  /** Only available when NIKKA_MOCK_ATLAS=1. */
  mock?: boolean;
}
