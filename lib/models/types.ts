import type { CameraCapabilities } from "@/lib/camera/phrasing";

export type ModelKind = "t2i" | "i2i" | "t2v" | "i2v" | "v2v" | "r2v" | "llm";
export type ModelTier = "sketch" | "draft" | "quality";

/** NIKKA-side inputs, mapped to each model's own schema by `mapInputs`. */
export interface GenericInputs {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  /** Temporary Atlas URLs (uploaded just before submission). */
  referenceImageUrls?: string[];
  startImageUrl?: string;
  /** Video to transform (video → video). */
  sourceVideoUrl?: string;
  /** Reference videos (reference → video: motion, style, edit, extension). */
  referenceVideoUrls?: string[];
  endImageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
  /** Definition picked in the node (1K/2K/4K, 720p…). */
  resolution?: string;
  quality?: string;
}

export type { CameraCapabilities };

/** PRD §4. Every entry must be verified against the model's published schema. */
export interface ModelEntry {
  id: string;
  label: string;
  kind: ModelKind;
  maxReferenceImages?: number;
  /** Reference → video models that also take videos as references. */
  maxReferenceVideos?: number;
  supportsStartEndFrames?: boolean;
  supportsSeed?: boolean;
  supportsNegativePrompt?: boolean;
  durations?: number[];
  /** The model takes a duration input. Without one, a video edit keeps the source's length. */
  supportsDuration?: boolean;
  /** Its duration can follow the input video (-1): editing a video keeps its length. */
  autoDuration?: boolean;
  /** Format / definition / quality offered by the model (from its schema). */
  options?: import("./options").ModelOptions;
  /** Learned real unit price per definition/quality ("2K", "4k", "1080p · high"…). */
  pricingByOption?: Record<string, number>;
  /** The base price was seen on a real bill (or is a known real price). */
  priceConfirmed?: boolean;
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
