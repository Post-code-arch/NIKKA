"use client";

import { useEffect, useState } from "react";
import type { ModelInfo } from "@/lib/models/registry";
import { api } from "./api";

let cache: Promise<{ mock: boolean; models: ModelInfo[] }> | null = null;

/** Registry entries usable right now (mock or real), fetched once per page. */
export function useModels() {
  const [data, setData] = useState<{ mock: boolean; models: ModelInfo[] } | null>(null);
  useEffect(() => {
    cache ??= api<{ mock: boolean; models: ModelInfo[] }>("/api/models");
    void cache.then(setData);
  }, []);
  return data;
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
