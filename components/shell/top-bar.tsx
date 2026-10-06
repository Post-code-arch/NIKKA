"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Play, Plus, Wallet, X } from "lucide-react";
import { IconPill, Island, Pill, pillClass } from "@/components/ui/pill";
import { formatUsd } from "@/lib/cost/estimate";
import { inFlightCount, useProjectStore } from "@/lib/store/project-store";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

const VIEWS = [
  { href: "/brief", label: "Brief" },
  { href: "/canvas", label: "Canvas" },
  { href: "/storyboard", label: "Storyboard" },
] as const;

function ProjectMenu({ onClose }: { onClose: () => void }) {
  const { projects, currentProjectId, selectProject, createProject } = useProjectStore();
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div ref={ref} className="island absolute top-11 left-1/2 z-30 w-72 -translate-x-1/2 p-1.5">
      <div className="max-h-64 overflow-y-auto">
        {projects.length === 0 && <p className="px-2 py-2 text-xs text-muted-foreground">Aucun projet</p>}
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              void selectProject(p.id);
              onClose();
            }}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2"
          >
            <span className="truncate">{p.name}</span>
            {p.id === currentProjectId && <Check className="size-3.5 text-muted-foreground" />}
          </button>
        ))}
      </div>
      <form
        className="mt-1 flex gap-1 border-t pt-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void createProject(name.trim()).then(onClose);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouveau projet…"
          className="h-8 min-w-0 flex-1 rounded-md bg-surface-2 px-2 text-xs outline-none placeholder:text-muted-foreground/60"
        />
        <IconPill type="submit" aria-label="Créer le projet" disabled={!name.trim()}>
          <Plus />
        </IconPill>
      </form>
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const { projects, currentProjectId, project, selectProject } = useProjectStore();
  const pending = useProjectStore((s) => inFlightCount(s.project));
  const [menuOpen, setMenuOpen] = useState(false);

  const idx = projects.findIndex((p) => p.id === currentProjectId);
  const current = idx >= 0 ? projects[idx] : null;
  const go = (delta: number) => {
    if (projects.length === 0) return;
    const next = projects[(Math.max(idx, 0) + delta + projects.length) % projects.length];
    void selectProject(next.id);
  };
  const shotCount = project?.sequences.reduce((n, s) => n + s.shots.length, 0) ?? 0;
  const budget = project?.settings.budgetUsd;

  return (
    <header className="pointer-events-none relative z-20 grid shrink-0 grid-cols-[1fr_auto_1fr] items-start gap-4 px-4 pt-4">
      <div className="pointer-events-auto flex items-center gap-3">
        <Link href="/storyboard" className="grid size-10 place-items-center">
          <Logo />
        </Link>
        <Island>
          {VIEWS.map((v) => (
            <Link key={v.href} href={v.href} className={pillClass(pathname.startsWith(v.href))}>
              {v.label}
            </Link>
          ))}
        </Island>
      </div>

      <div className="pointer-events-auto relative flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <IconPill aria-label="Projet précédent" disabled={projects.length < 2} onClick={() => go(-1)}>
            <ChevronLeft />
          </IconPill>
          <Island className="pr-1.5">
            <button type="button" onClick={() => setMenuOpen((o) => !o)} className="flex items-center gap-1.5 px-3 text-xs">
              <span className={cn("max-w-56 truncate", !current && "text-muted-foreground")}>
                {current?.name ?? "Choisir un projet"}
              </span>
              <ChevronDown className="size-3 text-muted-foreground" />
            </button>
            <IconPill
              aria-label="Fermer le projet"
              className="size-6 rounded-md bg-transparent"
              disabled={!current}
              onClick={() => void selectProject(null)}
            >
              <X />
            </IconPill>
          </Island>
          <IconPill aria-label="Projet suivant" disabled={projects.length < 2} onClick={() => go(1)}>
            <ChevronRight />
          </IconPill>
        </div>
        {menuOpen && <ProjectMenu onClose={() => setMenuOpen(false)} />}
        <span className="text-[11px] text-muted-foreground">
          {project
            ? `${project.sequences.length} séquence${project.sequences.length > 1 ? "s" : ""} · ${shotCount} plan${shotCount > 1 ? "s" : ""}`
            : "Aucun projet ouvert"}
        </span>
      </div>

      <div className="pointer-events-auto flex flex-col items-end gap-3">
        <Island>
          <Pill className="bg-transparent text-foreground" title="Générations en cours">
            {pending ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
            File d&apos;attente
          </Pill>
          <span className="grid h-8 min-w-8 place-items-center rounded-[10px] bg-surface-2 px-2 font-mono text-xs">
            {pending}
          </span>
        </Island>
        <Island className="px-3 py-1.5 text-xs" title="Coût réel / estimé du projet">
          <Wallet className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Projet</span>
          <span className="font-mono">{formatUsd(project?.cost.actualUsd ?? 0)}</span>
          {budget !== undefined && <span className="font-mono text-muted-foreground">/ {formatUsd(budget)}</span>}
        </Island>
      </div>
    </header>
  );
}
