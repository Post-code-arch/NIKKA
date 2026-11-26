"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ShotStatus } from "@/db/schema";

export type StoryboardFilters = { status?: ShotStatus; characterId?: string; locationId?: string };

/** Per-viewer UI state (local only). */
export const useUiStore = create<{
  bibleOpen: boolean;
  setBibleOpen: (open: boolean) => void;
  /** Canvas: the node library panel on the left. */
  nodePanelOpen: boolean;
  setNodePanelOpen: (open: boolean) => void;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
  /** Storyboard: board (grid) or timeline (real durations). */
  storyboardView: "board" | "timeline";
  setStoryboardView: (v: "board" | "timeline") => void;
  filters: StoryboardFilters;
  setFilters: (f: StoryboardFilters) => void;
  /** Multiple selection for batch generation. */
  picked: string[];
  togglePicked: (id: string) => void;
  setPicked: (ids: string[]) => void;
}>()(
  persist(
    (set) => ({
      bibleOpen: true,
      setBibleOpen: (bibleOpen) => set({ bibleOpen }),
      nodePanelOpen: true,
      setNodePanelOpen: (nodePanelOpen) => set({ nodePanelOpen }),
      selectedShotId: null,
      selectShot: (selectedShotId) => set({ selectedShotId }),
      storyboardView: "board",
      setStoryboardView: (storyboardView) => set({ storyboardView }),
      filters: {},
      setFilters: (filters) => set({ filters }),
      picked: [],
      togglePicked: (id) => set((s) => ({ picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : [...s.picked, id] })),
      setPicked: (picked) => set({ picked }),
    }),
    { name: "nikka-ui", partialize: (s) => ({ bibleOpen: s.bibleOpen, storyboardView: s.storyboardView, nodePanelOpen: s.nodePanelOpen }) },
  ),
);
