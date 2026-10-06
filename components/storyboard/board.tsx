"use client";

import { useState } from "react";
import { FolderPlus, Plus } from "lucide-react";
import { CornerStats } from "@/components/shell/corner-stats";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { SequenceTree } from "@/lib/projects/queries";
import { formatUsd } from "@/lib/cost/estimate";
import { api } from "@/lib/store/api";
import { inFlightCount, useProjectStore } from "@/lib/store/project-store";
import { ShotCard } from "./shot-card";

function SequenceRow({ seq, index, onChanged }: { seq: SequenceTree; index: number; onChanged: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const [title, setTitle] = useState(seq.title.value);
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title !== seq.title.value &&
            void api(`/api/sequences/${seq.id}`, { method: "PATCH", body: { title: { value: title, origin: "validated" } } }).then(onChanged)
          }
          className="rounded-md bg-transparent px-1.5 py-0.5 text-sm outline-none focus:bg-surface-2"
        />
        <Pill onClick={() => void api(`/api/sequences/${seq.id}/shots`, { body: {} }).then(onChanged)}>
          <Plus /> Plan
        </Pill>
      </div>
      <div className="flex gap-5 overflow-x-auto pb-2">
        {seq.shots.map((sh, i) => (
          <ShotCard key={sh.id} shot={sh} number={`${index + 1}.${i + 1}`} assets={project.assets} onChanged={onChanged} />
        ))}
        {seq.shots.length === 0 && <p className="py-6 text-xs text-muted-foreground">Aucun plan dans cette séquence.</p>}
      </div>
    </section>
  );
}

function EmptyState() {
  const createProject = useProjectStore((s) => s.createProject);
  const [name, setName] = useState("");
  return (
    <div className="grid flex-1 place-items-center">
      <form
        className="island w-80 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void createProject(name.trim());
        }}
      >
        <h1 className="mb-1 text-sm font-medium">Nouveau projet</h1>
        <p className="mb-3 text-xs text-muted-foreground">Ou choisis un projet existant dans le menu du haut.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom du projet"
          className="mb-3 h-9 w-full rounded-md bg-surface-2 px-2 text-xs outline-none placeholder:text-muted-foreground/60"
        />
        <Button className="w-full" type="submit" disabled={!name.trim()}>
          <FolderPlus /> Créer le projet
        </Button>
      </form>
    </div>
  );
}

/** Phase 1 board: sequences, shots, generation and takes. Full storyboard comes in phase 6. */
export function Board() {
  const { project, currentProjectId, refresh } = useProjectStore();
  const pending = inFlightCount(project);
  if (!currentProjectId) return <EmptyState />;
  if (!project) return <div className="grid flex-1 place-items-center text-xs text-muted-foreground">Chargement…</div>;
  const shots = project.sequences.flatMap((s) => s.shots);
  const takes = shots.reduce((n, s) => n + s.takes.length, 0);
  const onChanged = () => void refresh();

  return (
    <div className="relative flex-1 overflow-y-auto px-8 pt-8 pb-24">
      {project.sequences.map((seq, i) => (
        <SequenceRow key={seq.id} seq={seq} index={i} onChanged={onChanged} />
      ))}
      <Pill onClick={() => void api(`/api/projects/${project.id}/sequences`, { body: {} }).then(onChanged)}>
        <Plus /> Séquence
      </Pill>
      <CornerStats
        side="left"
        items={[
          ["Coût", formatUsd(project.cost.actualUsd)],
          ["Plans", String(shots.length)],
          ["Prises", String(takes)],
          ["Jobs", String(pending)],
        ]}
      />
    </div>
  );
}
