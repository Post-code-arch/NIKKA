import { isMockMode } from "@/lib/atlas/config";
import { MOCK_LLMS, MOCK_MODELS } from "./mock";
import { readStore } from "./store";
import type { LlmDescriptor } from "./catalog-adapter";
import type { ModelEntry, ModelKind } from "./types";

/**
 * Hand-written Atlas adapters (none yet). Models picked from the catalog in
 * a node are added at runtime from their published schema (lib/models/store).
 */
export const ATLAS_MODELS: ModelEntry[] = [];

export function availableModels(kind?: ModelKind): ModelEntry[] {
  const list = isMockMode() ? MOCK_MODELS : [...ATLAS_MODELS, ...readStore().entries];
  return kind ? list.filter((m) => m.kind === kind) : list;
}

export function getModel(id: string): ModelEntry | undefined {
  return availableModels().find((m) => m.id === id);
}

/** LLMs usable by the digester and the prompt enhancer. */
export function availableLlms(): LlmDescriptor[] {
  return isMockMode() ? MOCK_LLMS : readStore().llm;
}

/** The LLM to use: the one asked for if enabled, else NIKKA_LLM_MODEL, else the first enabled. */
export function resolveLlm(preferred?: string): LlmDescriptor | undefined {
  const list = availableLlms();
  return list.find((m) => m.id === preferred) ?? list.find((m) => m.id === process.env.NIKKA_LLM_MODEL) ?? list[0];
}

/** Client-safe description (no adapter function). */
export type ModelInfo = Omit<ModelEntry, "mapInputs">;

export function toModelInfo({ mapInputs: _unused, ...info }: ModelEntry): ModelInfo {
  void _unused;
  return info;
}
