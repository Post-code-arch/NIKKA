"use client";

import { useEffect } from "react";
import { inFlightCount, useProjectStore } from "@/lib/store/project-store";

/** Loads projects once and keeps the current project fresh while jobs run. */
export function ProjectSync() {
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const refresh = useProjectStore((s) => s.refresh);
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const pending = useProjectStore((s) => inFlightCount(s.project));

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void refresh();
  }, [currentProjectId, refresh]);

  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void fetch("/api/jobs?active=1").finally(() => void refresh());
    }, 1500);
    return () => clearInterval(t);
  }, [pending, refresh]);

  return null;
}
