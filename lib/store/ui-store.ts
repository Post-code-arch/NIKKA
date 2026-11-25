"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-viewer UI state (local only). */
export const useUiStore = create<{
  bibleOpen: boolean;
  setBibleOpen: (open: boolean) => void;
  selectedShotId: string | null;
  selectShot: (id: string | null) => void;
}>()(
  persist(
    (set) => ({
      bibleOpen: true,
      setBibleOpen: (bibleOpen) => set({ bibleOpen }),
      selectedShotId: null,
      selectShot: (selectedShotId) => set({ selectedShotId }),
    }),
    { name: "nikka-ui", partialize: (s) => ({ bibleOpen: s.bibleOpen }) },
  ),
);
