"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-viewer UI state (local only). */
export const useUiStore = create<{
  bibleOpen: boolean;
  setBibleOpen: (open: boolean) => void;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
  /** Canvas: sequence shown, and the shot whose recipe is unfolded. */
  canvasSequenceId: string | null;
  openShotId: string | null;
  setCanvas: (patch: { canvasSequenceId?: string | null; openShotId?: string | null }) => void;
}>()(
  persist(
    (set) => ({
      bibleOpen: true,
      setBibleOpen: (bibleOpen) => set({ bibleOpen }),
      selectedShotId: null,
      selectShot: (selectedShotId) => set({ selectedShotId }),
      canvasSequenceId: null,
      openShotId: null,
      setCanvas: (patch) => set(patch),
    }),
    { name: "nikka-ui", partialize: (s) => ({ bibleOpen: s.bibleOpen, canvasSequenceId: s.canvasSequenceId, openShotId: s.openShotId }) },
  ),
);
