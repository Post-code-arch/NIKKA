"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectTree } from "@/lib/projects/queries";
import { api } from "./api";

export type ProjectSummary = { id: string; name: string; updatedAt: number };

interface ProjectState {
  currentProjectId: string | null;
  projects: ProjectSummary[];
  project: ProjectTree | null;
  loading: boolean;
  error: string | null;
  loadProjects: () => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      projects: [],
      project: null,
      loading: false,
      error: null,
      loadProjects: async () => {
        const projects = await api<ProjectSummary[]>("/api/projects");
        set({ projects });
        const { currentProjectId } = get();
        if (currentProjectId && !projects.some((p) => p.id === currentProjectId)) {
          set({ currentProjectId: null, project: null });
        }
      },
      selectProject: async (id) => {
        set({ currentProjectId: id, project: null });
        if (id) await get().refresh();
      },
      refresh: async () => {
        const id = get().currentProjectId;
        if (!id) {
          set({ project: null });
          return;
        }
        try {
          const project = await api<ProjectTree>(`/api/projects/${id}`);
          if (get().currentProjectId === id) set({ project, error: null });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      createProject: async (name) => {
        const p = await api<ProjectSummary>("/api/projects", { body: { name } });
        await get().loadProjects();
        await get().selectProject(p.id);
      },
    }),
    {
      name: "nikka-project",
      partialize: (s) => ({ currentProjectId: s.currentProjectId }),
    },
  ),
);

/** Takes still waiting on Atlas in the current project. */
export function inFlightCount(project: ProjectTree | null): number {
  if (!project) return 0;
  let n = 0;
  for (const s of project.sequences)
    for (const sh of s.shots) for (const t of sh.takes) if (t.status === "queued" || t.status === "processing") n++;
  return n;
}
