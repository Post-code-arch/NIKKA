"use client";

import { ReactFlowProvider } from "@xyflow/react";
import { Plus } from "lucide-react";
import { Island, Pill } from "@/components/ui/pill";
import { api } from "@/lib/store/api";
import { useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { ShotGraph } from "./shot-graph";

/**
 * Canvas view: one free node canvas per shot. The storyboard keeps its rigid
 * pipeline; here the user builds workflows and sends results to the shot.
 */
export function CanvasView() {
  const project = useProjectStore((s) => s.project);
  const refresh = useProjectStore((s) => s.refresh);
  const { openShotId, setCanvas } = useUiStore();

  if (!project) {
    return (
      <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
        Ouvre ou crée un projet (menu du haut, ou onglet Storyboard).
      </div>
    );
  }

  const shots = project.sequences.flatMap((s, i) => s.shots.map((sh, j) => ({ sh, seq: s, number: `${i + 1}.${j + 1}` })));
  const current = shots.find((x) => x.sh.id === openShotId) ?? shots[0];

  const addShot = () => {
    const seq = current?.seq ?? project.sequences[0];
    const create = seq
      ? Promise.resolve(seq.id)
      : api<{ id: string }>(`/api/projects/${project.id}/sequences`, { body: {} }).then((s) => s.id);
    void create
      .then((seqId) => api<{ id: string }>(`/api/sequences/${seqId}/shots`, { body: {} }))
      .then((shot) => {
        setCanvas({ openShotId: shot.id });
        return refresh();
      });
  };

  return (
    <ReactFlowProvider>
      {current ? (
        <ShotGraph key={current.sh.id} project={project} shot={current.sh} number={current.number} />
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="island w-80 p-4 text-center">
            <p className="mb-1 text-sm">Aucun plan</p>
            <p className="mb-3 text-[11px] text-muted-foreground">Chaque plan a son propre canvas nodal. Crée un premier plan.</p>
            <Pill className="mx-auto bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" onClick={addShot}>
              <Plus /> Ajouter un plan
            </Pill>
          </div>
        </div>
      )}

      {/* Shot navigator */}
      {shots.length > 0 && (
        <div className="pointer-events-none absolute right-4 bottom-4 left-[300px] z-10 flex justify-center">
          <Island className="pointer-events-auto max-w-full overflow-x-auto">
            {project.sequences.map((seq, i) => (
              <div key={seq.id} className="flex items-center gap-1">
                {i > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-border" />}
                <span className="shrink-0 px-1 text-[10px] text-muted-foreground" title={seq.title.value}>
                  Séq. {i + 1}
                </span>
                {seq.shots.map((sh, j) => (
                  <Pill
                    key={sh.id}
                    active={sh.id === current?.sh.id}
                    onClick={() => setCanvas({ openShotId: sh.id })}
                    title={sh.description.value || "Sans action"}
                    className={cn("shrink-0 px-2.5 font-mono")}
                  >
                    {i + 1}.{j + 1}
                  </Pill>
                ))}
              </div>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
            <Pill className="shrink-0" onClick={addShot} title="Nouveau plan dans la séquence en cours">
              <Plus /> Plan
            </Pill>
          </Island>
        </div>
      )}

    </ReactFlowProvider>
  );
}
