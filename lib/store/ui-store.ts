"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-viewer UI preferences (local only). */
export const useUiStore = create<{ bibleOpen: boolean; setBibleOpen: (open: boolean) => void }>()(
  persist((set) => ({ bibleOpen: true, setBibleOpen: (bibleOpen) => set({ bibleOpen }) }), { name: "nikka-ui" }),
);
