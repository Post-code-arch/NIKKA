"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { Plus } from "lucide-react";
import { CornerStats } from "@/components/shell/corner-stats";
import { Island, Pill } from "@/components/ui/pill";
import { formatUsd } from "@/lib/cost/estimate";
import { api } from "@/lib/store/api";
import { inFlightCount, useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { SequenceCanvas } from "./sequence-canvas";
import { ShotGraph } from "./shot-graph";

/** Canvas view (PRD §9): the sequence's shots as folded recipes, or one unfolded shot graph. */
export function CanvasView() {
  const project = useProjectStore((s) => s.project);
  const refresh = useProjectStore((s) => s.refresh);
  const { canvasSequenceId, openShotId, setCanvas } = useUiStore();

  if (!project) {
    return (
      <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
        Ouvre ou crée un projet (menu du haut, ou onglet Storyboard).
      </div>
    );
  }
  // Remembered sequence, else the first one that has shots.
  const remembered = project.sequences.findIndex((s) => s.id === canvasSequenceId);
  const seqIndex = remembered >= 0 ? remembered : Math.max(0, project.sequences.findIndex((s) => s.shots.length > 0));
  const sequence = project.sequences[seqIndex];
  const openShot = project.sequences.flatMap((s, i) => s.shots.map((sh, j) => ({ sh, number: `${i + 1}.${j + 1}` }))).find((x) => x.sh.id === openShotId);
  const shots = project.sequences.flatMap((s) => s.shots);

  return (
    <ReactFlowProvider>
      {openShot ? (
        <ShotGraph key={openShot.sh.id} project={project} shot={openShot.sh} number={openShot.number} onBack={() => setCanvas({ openShotId: null })} />
      ) : (
        <>
          {sequence ? (
            <SequenceCanvas
              key={sequence.id}
              project={project}
              sequence={sequence}
              index={seqIndex}
              onOpen={(id) => setCanvas({ openShotId: id })}
            />
          ) : (
            <div className="grid flex-1 place-items-center text-xs text-muted-foreground">Aucune séquence : crée-en une.</div>
          )}
          <div className="pointer-events-none absolute top-3 right-4 left-[300px] z-10 flex justify-start">
            <Island className="pointer-events-auto">
              {project.sequences.map((s, i) => (
                <Pill key={s.id} active={s.id === sequence?.id} onClick={() => setCanvas({ canvasSequenceId: s.id })}>
                  <span className="font-mono">{i + 1}</span> {s.title.value}
                  <span className="font-mono text-muted-foreground">{s.shots.length}</span>
                </Pill>
              ))}
              {sequence && (
                <Pill onClick={() => void api(`/api/sequences/${sequence.id}/shots`, { body: {} }).then(() => refresh())}>
                  <Plus /> Plan
                </Pill>
              )}
              <Pill
                onClick={() =>
                  void api<{ id: string }>(`/api/projects/${project.id}/sequences`, { body: {} }).then((s) => {
                    setCanvas({ canvasSequenceId: s.id });
                    return refresh();
                  })
                }
              >
                <Plus /> Séquence
              </Pill>
            </Island>
          </div>
        </>
      )}
      <CornerStats
        side="left"
        items={[
          ["Coût", formatUsd(project.cost.actualUsd)],
          ["Plans", String(shots.length)],
          ["Prises", String(shots.reduce((n, s) => n + s.takes.length, 0))],
          ["Jobs", String(inFlightCount(project))],
        ]}
      />
    </ReactFlowProvider>
  );
}
