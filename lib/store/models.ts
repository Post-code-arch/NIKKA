"use client";

import { useEffect, useState } from "react";
import type { LlmDescriptor } from "@/lib/models/catalog-adapter";
import type { ModelInfo } from "@/lib/models/registry";
import { api } from "./api";

export type ModelsData = { mock: boolean; models: ModelInfo[]; llms: LlmDescriptor[] };

let cache: Promise<ModelsData> | null = null;
const listeners = new Set<(d: ModelsData) => void>();

/** Registry entries usable right now (mock or enabled Atlas models), shared by the page. */
export function useModels() {
  const [data, setData] = useState<ModelsData | null>(null);
  useEffect(() => {
    cache ??= api<ModelsData>("/api/models");
    void cache.then(setData);
    listeners.add(setData);
    return () => {
      listeners.delete(setData);
    };
  }, []);
  return data;
}

/** After enabling a model from the catalog: every node sees it. */
export async function reloadModels() {
  cache = api<ModelsData>("/api/models");
  const d = await cache;
  listeners.forEach((l) => l(d));
  return d;
}

/** The project's default keyframe / video models, else the first available. */
export function defaultModels(models: ModelInfo[] | undefined, settings: { defaultModels: Record<string, string> } | undefined) {
  const keyframeChoices = (models ?? []).filter((m) => m.kind === "t2i" || m.kind === "i2i");
  const videoChoices = (models ?? []).filter((m) => m.kind === "i2v");
  const pick = (list: ModelInfo[], id?: string) => list.find((m) => m.id === id)?.id ?? list[0]?.id ?? null;
  return {
    keyframeChoices,
    videoChoices,
    keyframe: pick(keyframeChoices, settings?.defaultModels.keyframe),
    video: pick(videoChoices, settings?.defaultModels.video),
  };
}
