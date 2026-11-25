"use client";

import "@xyflow/react/dist/style.css";
import { createContext, useContext, useMemo, useState } from "react";
import { Background, BackgroundVariant, ReactFlow, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { Clapperboard, Crosshair, Film, Grid2x2, Maximize2, Minus, Plus, Sparkles } from "lucide-react";
import { MovementIcon, ScaleIcon } from "@/components/camera/icons";
import { Thumb } from "@/components/bible/view-thumb";
import { GradientEdge } from "@/components/nodes/gradient-edge";
import { NodeCard } from "@/components/nodes/node-card";
import { IconPill, Island, Pill } from "@/components/ui/pill";
import { MOVEMENT_LABEL, SCALE_LABEL } from "@/lib/camera/labels";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import type { ProjectTree, SequenceTree, ShotWithTakes } from "@/lib/projects/queries";
import { RECIPES, isRecipeId } from "@/lib/recipes";
import { TAG_COLOR_VAR } from "@/lib/refs/views";
import { api, assetUrl } from "@/lib/store/api";
import { useProjectStore } from "@/lib/store/project-store";
import { cn } from "@/lib/utils";
import { useRunner, type RunRequest } from "./run-confirm";
import { NIKKA_REF_MIME } from "./shot-graph";

interface SeqCtx {
  project: ProjectTree;
  run: (req: RunRequest) => void;
  open: (shotId: string) => void;
  branch: (shot: ShotWithTakes, refId: string) => void;
}
const SequenceContext = createContext<SeqCtx | null>(null);

type BlockData = { shot: ShotWithTakes; number: string };

/** A shot = its recipe folded into one block (PRD §9). */
function ShotBlock({ data }: NodeProps<Node<BlockData>>) {
  const ctx = useContext(SequenceContext)!;
  const { shot, number } = data;
  const [over, setOver] = useState(false);
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  const completed = shot.takes.filter((t) => t.status === "completed");
  const retained = completed.find((t) => t.id === shot.selectedTakeId) ?? completed[0];
  const running = shot.takes.filter((t) => t.status === "queued" || t.status === "processing").length;
  const asset = retained?.assetId ? ctx.project.assets[retained.assetId] : undefined;
  const refs = shot.refIds.map((id) => ctx.project.references.find((r) => r.id === id)).filter((r) => !!r);
  const hasKeyframe = completed.some((t) => t.stage !== "video");
  const recipe = isRecipeId(shot.recipeId) ? RECIPES[shot.recipeId].label : "Libre";

  return (
    <div
      onDoubleClick={() => ctx.open(shot.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(NIKKA_REF_MIME)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(NIKKA_REF_MIME);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          ctx.branch(shot, id);
        }
      }}
    >
      <NodeCard
        title={`Plan ${number} · ${recipe}`}
        width={300}
        glow={running ? "var(--port-image)" : over ? "var(--tag-character)" : undefined}
        className={cn(over && "scale-[1.02] transition-transform")}
      >
        <div className="relative aspect-video overflow-hidden rounded-[10px] bg-surface-2">
          {asset ? (
            asset.kind === "video" ? (
              <video src={`${assetUrl(asset.id)}#t=0.1`} preload="metadata" muted loop playsInline className="size-full object-cover"
                onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(asset.id)} alt="" className="size-full object-cover" />
            )
          ) : running ? (
            <Thumb status="processing" className="size-full" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground/50">
              <Clapperboard className="size-6" />
            </div>
          )}
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-white" title={`${SCALE_LABEL[camera.scale]} · ${MOVEMENT_LABEL[camera.movement]}`}>
            <ScaleIcon scale={camera.scale} className="size-4" />
            <MovementIcon movement={camera.movement} className="size-4" />
          </div>
          {over && (
            <div className="absolute inset-0 grid place-items-center bg-black/50 text-xs">Brancher la référence</div>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          {shot.description.value || "Action du plan…"}
        </p>
        <div className="mt-1 flex min-h-5 flex-wrap gap-1 px-1">
          {refs.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">
              <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[r.tag] }} />
              {r.name}
            </span>
          ))}
          {refs.length === 0 && <span className="text-[10px] text-muted-foreground/60">Glisse une référence de la bible ici</span>}
        </div>
        <div className="nodrag mt-1.5 flex items-center gap-1 px-0.5 pb-0.5">
          <Pill className="h-7 flex-1 justify-center px-2 text-[11px]" onClick={() => ctx.run({ shotId: shot.id, until: "keyframe" })} disabled={!shot.description.value.trim()}>
            <Sparkles /> Image clé
          </Pill>
          <Pill className="h-7 px-2 font-mono text-[11px]" title="4 variantes" onClick={() => ctx.run({ shotId: shot.id, until: "keyframe", variants: 4 })} disabled={!shot.description.value.trim()}>
            ×4
          </Pill>
          <Pill className="h-7 px-2 text-[11px]" onClick={() => ctx.run({ shotId: shot.id, until: "video" })} disabled={!hasKeyframe && shot.recipeId !== "continuity"} title={hasKeyframe ? "Animer la prise retenue" : "Il faut d'abord une image clé"}>
            <Film /> Animer
          </Pill>
          <IconPill aria-label="Déplier la recette" title="Déplier la recette" className="size-7" onClick={() => ctx.open(shot.id)}>
            <Maximize2 />
          </IconPill>
        </div>
      </NodeCard>
    </div>
  );
}

const nodeTypes = { shotBlock: ShotBlock };
const edgeTypes = { gradient: GradientEdge };

/** Global canvas: the current sequence, one folded recipe per shot. */
export function SequenceCanvas({
  project,
  sequence,
  index,
  onOpen,
}: {
  project: ProjectTree;
  sequence: SequenceTree;
  index: number;
  onOpen: (shotId: string) => void;
}) {
  const rf = useReactFlow();
  const refresh = useProjectStore((s) => s.refresh);
  const { run, dialog } = useRunner(() => void refresh());

  const nodes: Node<BlockData>[] = useMemo(
    () =>
      sequence.shots.map((sh, i) => ({
        id: sh.id,
        type: "shotBlock",
        position: { x: i * 360, y: 0 },
        data: { shot: sh, number: `${index + 1}.${i + 1}` },
        draggable: false,
        connectable: false,
      })),
    [sequence.shots, index],
  );
  const edges: Edge[] = useMemo(
    () =>
      sequence.shots.slice(1).map((sh, i) => ({
        id: `seq-${i}`,
        source: sequence.shots[i].id,
        target: sh.id,
        type: "gradient",
        data: { from: "rgba(255,255,255,0.25)", to: "rgba(255,255,255,0.25)" },
        selectable: false,
      })),
    [sequence.shots],
  );

  const ctx: SeqCtx = {
    project,
    run: (req) => void run(req),
    open: onOpen,
    branch: (shot, refId) => {
      if (shot.refIds.includes(refId)) return;
      void api(`/api/shots/${shot.id}`, { method: "PATCH", body: { refIds: [...shot.refIds, refId] } }).then(() => refresh());
    },
  };

  return (
    <SequenceContext.Provider value={ctx}>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: { top: "140px", bottom: "80px", left: "320px", right: "100px" }, maxZoom: 1 }}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          minZoom={0.2}
          maxZoom={1.6}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.07)" />
        </ReactFlow>
        {sequence.shots.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            Aucun plan dans cette séquence.
          </div>
        )}
        <Island className="absolute top-1/2 right-4 z-10 -translate-y-1/2 flex-col">
          <IconPill className="bg-transparent" aria-label="Zoom avant" onClick={() => rf.zoomIn()}><Plus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Zoom arrière" onClick={() => rf.zoomOut()}><Minus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Ajuster" onClick={() => rf.fitView({ padding: 0.2, maxZoom: 1 })}><Grid2x2 /></IconPill>
          <IconPill className="bg-transparent" aria-label="Recentrer" onClick={() => rf.fitView({ padding: 0.3, maxZoom: 1 })}><Crosshair /></IconPill>
        </Island>
        <p className="pointer-events-none absolute right-4 bottom-4 z-10 text-[10px] text-muted-foreground">
          Double-clic sur un plan pour déplier sa recette
        </p>
        {dialog}
      </div>
    </SequenceContext.Provider>
  );
}
