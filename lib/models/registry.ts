import { isMockMode } from "@/lib/atlas/config";
import { MOCK_MODELS } from "./mock";
import type { ModelEntry, ModelKind } from "./types";

/**
 * Real Atlas models. Empty on purpose: the selection (PRD §4 "Modèles
 * nécessaires en V1") is proposed from the live catalog and each model's
 * schema, then validated by the user before being filled in here.
 */
export const ATLAS_MODELS: ModelEntry[] = [];

export function availableModels(kind?: ModelKind): ModelEntry[] {
  const list = isMockMode() ? MOCK_MODELS : ATLAS_MODELS;
  return kind ? list.filter((m) => m.kind === kind) : list;
}

export function getModel(id: string): ModelEntry | undefined {
  return availableModels().find((m) => m.id === id);
}

/** Client-safe description (no adapter function). */
export type ModelInfo = Omit<ModelEntry, "mapInputs">;

export function toModelInfo({ mapInputs: _unused, ...info }: ModelEntry): ModelInfo {
  void _unused;
  return info;
}
