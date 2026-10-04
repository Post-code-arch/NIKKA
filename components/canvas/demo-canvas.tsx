"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  Grid2x2,
  History,
  Images,
  Lock,
  Maximize2,
  Minus,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { CornerStats } from "@/components/shell/corner-stats";
import { GradientEdge } from "@/components/nodes/gradient-edge";
import { NodeCard, NodeChip, NodeField, NodePanel, NodeValue, PortDot } from "@/components/nodes/node-card";
import { Port } from "@/components/nodes/port";
import { IconPill, Island, Pill } from "@/components/ui/pill";

/**
 * Visual preview of the node editor (docs/design/DESIGN.md).
 * Static demo graph only — the functional canvas lands in phase 4.
 */

const C = {
  character: "var(--tag-character)",
  text: "var(--port-text)",
  negative: "var(--destructive)",
  image: "var(--port-image)",
};

function ReferenceNode() {
  return (
    <NodeCard title="Référence" width={220}>
      <NodePanel className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-lg bg-[radial-gradient(circle_at_35%_30%,#f9c6a8,#a0526b_55%,#2b1830)]" />
          <div>
            <div className="text-xs">Lina</div>
            <div className="text-[10px] text-muted-foreground">Costume de nuit · 6 vues</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-[10px]">
            <PortDot color={C.character} /> Personnage
          </span>
          <Port id="ref" kind="source" color={C.character} label="vues" />
        </div>
      </NodePanel>
    </NodeCard>
  );
}

function PromptNode({ data }: NodeProps<Node<{ negative?: boolean }>>) {
  const negative = !!data.negative;
  return (
    <NodeCard title={negative ? "Négatif" : "Prompt"} width={250}>
      <NodePanel className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px]">
            <PortDot color={negative ? C.negative : C.text} />
            {negative ? "Négatif" : "Positif"}
          </span>
          <Port id="out" kind="source" color={negative ? C.negative : C.text} label="" />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {negative
            ? "Pas de texte, pas de détails inutiles, pas d'autres personnages."
            : "Lina sur le quai désert, néons dans la brume, plan rapproché, contre-jour."}
        </p>
        <div className="rounded-md bg-surface px-2 py-2 text-[10px] text-muted-foreground/70">
          {negative ? "Ce qu'il faut éviter…" : "Action du plan…"}
        </div>
      </NodePanel>
    </NodeCard>
  );
}

function ImageEditNode() {
  return (
    <NodeCard
      title="Image clé · édition multi-réf"
      width={270}
      glow="var(--port-video)"
      action={
        <NodeChip>
          <Sparkles /> Générer
        </NodeChip>
      }
    >
      <NodePanel>
        <div className="mb-2 flex items-start justify-between">
          <div>
            <Port id="refs" kind="target" color={C.character} label="références" />
            <Port id="pos" kind="target" color={C.text} label="positif" />
            <Port id="neg" kind="target" color={C.negative} label="négatif" />
          </div>
          <Port id="image" kind="source" color={C.image} label="image" />
        </div>
        <NodeField label="Modèle">
          <NodeValue>
            Seedream <ChevronDown />
          </NodeValue>
        </NodeField>
        <NodeField label="Seed">
          <NodeValue mono>
            12345 <Lock />
          </NodeValue>
        </NodeField>
        <NodeField label="Variantes">
          <div className="flex items-center gap-1">
            <NodeValue className="min-w-0 px-1.5">
              <ChevronLeft />
            </NodeValue>
            <NodeValue mono className="min-w-10 justify-center">
              4
            </NodeValue>
            <NodeValue className="min-w-0 px-1.5">
              <ChevronRight />
            </NodeValue>
          </div>
        </NodeField>
        <NodeField label="Coût estimé">
          <NodeValue mono className="justify-end">
            $0.128
          </NodeValue>
        </NodeField>
      </NodePanel>
    </NodeCard>
  );
}

function TakeNode() {
  return (
    <div className="flex flex-col items-center gap-3">
      <NodeCard title="Prise · image clé" width={260}>
        <div className="mb-1.5 flex items-center justify-between px-1.5 pt-0.5">
          <Port id="in" kind="target" color={C.image} label="image" edgeOffset={13} />
          <Port id="out" kind="source" color={C.image} label="vers vidéo" edgeOffset={13} />
        </div>
        <div className="relative aspect-[3/4] overflow-hidden rounded-[10px] bg-[radial-gradient(ellipse_at_30%_30%,#ff9a8b_0%,#c86dd7_30%,#3b82f6_60%,#0b1020_100%)]">
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-10">
            <div className="text-xs font-medium">Prise 3 · retenue</div>
            <p className="mt-1 text-[10px] leading-relaxed text-white/70">
              Lina sur le quai désert, néons dans la brume, plan rapproché, contre-jour.
            </p>
          </div>
        </div>
      </NodeCard>
      <Island className="nodrag">
        <IconPill className="bg-transparent" aria-label="Agrandir"><Maximize2 /></IconPill>
        <IconPill className="bg-transparent" aria-label="Prises"><Images /></IconPill>
        <IconPill className="bg-transparent" aria-label="Dupliquer"><Copy /></IconPill>
        <IconPill className="bg-transparent" aria-label="Supprimer"><Trash2 /></IconPill>
        <Pill className="font-mono">×4 <ChevronDown /></Pill>
        <Pill className="font-mono">PNG <ChevronDown /></Pill>
        <IconPill className="bg-transparent" aria-label="Télécharger"><Download /></IconPill>
      </Island>
    </div>
  );
}

const nodeTypes = {
  reference: ReferenceNode,
  prompt: PromptNode,
  imageEdit: ImageEditNode,
  take: TakeNode,
};

const nodes: Node[] = [
  { id: "ref", type: "reference", position: { x: 330, y: -150 }, data: {} },
  { id: "pos", type: "prompt", position: { x: 300, y: 20 }, data: {} },
  { id: "neg", type: "prompt", position: { x: 300, y: 260 }, data: { negative: true } },
  { id: "img", type: "imageEdit", position: { x: 660, y: 60 }, data: {} },
  { id: "take", type: "take", position: { x: 1010, y: -40 }, data: {} },
];

const edgeTypes = { gradient: GradientEdge };

const edges: Edge[] = [
  { id: "e1", type: "gradient", source: "ref", sourceHandle: "ref", target: "img", targetHandle: "refs", data: { from: C.character } },
  { id: "e2", type: "gradient", source: "pos", sourceHandle: "out", target: "img", targetHandle: "pos", data: { from: C.text } },
  { id: "e3", type: "gradient", source: "neg", sourceHandle: "out", target: "img", targetHandle: "neg", data: { from: C.negative } },
  { id: "e4", type: "gradient", source: "img", sourceHandle: "image", target: "take", targetHandle: "in", data: { from: C.image } },
];

function ZoomDock() {
  const rf = useReactFlow();
  return (
    <Island className="absolute top-1/2 right-4 z-10 -translate-y-1/2 flex-col">
      <IconPill className="bg-transparent" aria-label="Zoom avant" onClick={() => rf.zoomIn()}><Plus /></IconPill>
      <IconPill className="bg-transparent" aria-label="Zoom arrière" onClick={() => rf.zoomOut()}><Minus /></IconPill>
      <IconPill className="bg-transparent" aria-label="Ajuster" onClick={() => rf.fitView({ padding: 0.2 })}><Grid2x2 /></IconPill>
      <IconPill className="bg-transparent" aria-label="Recentrer" onClick={() => rf.setCenter(600, 220, { zoom: 1 })}><Crosshair /></IconPill>
      <IconPill className="bg-transparent" aria-label="Réglages"><Settings2 /></IconPill>
    </Island>
  );
}

function PromptDock() {
  return (
    <div className="island absolute bottom-6 left-1/2 z-10 w-[min(420px,calc(100%-2rem))] -translate-x-1/2 p-2">
      <div className="rounded-[10px] bg-surface-2 px-3 py-2">
        <div className="mb-1 h-0.5 w-6 rounded bg-muted-foreground/40" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Lina sur le quai désert, néons dans la brume, plan rapproché, contre-jour.
        </p>
      </div>
      <div className="mt-2 flex items-center justify-center gap-1">
        <IconPill className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" aria-label="Historique">
          <History />
        </IconPill>
        <IconPill className="bg-transparent" aria-label="Variantes"><Images /></IconPill>
        <IconPill className="bg-transparent" aria-label="Améliorer"><Wand2 /></IconPill>
        <IconPill className="bg-transparent" aria-label="Dupliquer"><Copy /></IconPill>
        <span className="mx-2 h-4 w-px bg-border" />
        <IconPill className="bg-transparent" aria-label="Verrouiller"><Lock /></IconPill>
        <IconPill className="bg-transparent" aria-label="Réglages"><Settings2 /></IconPill>
      </div>
    </div>
  );
}

export function DemoCanvas() {
  return (
    <ReactFlowProvider>
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: { top: 0.1, bottom: 0.3, left: 0.1, right: 0.15 } }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.07)" />
        </ReactFlow>
        <ZoomDock />
        <PromptDock />
        <CornerStats
          side="left"
          items={[
            ["Coût", "$0.000"],
            ["Plans", "0"],
            ["Prises", "0"],
            ["Jobs", "0"],
          ]}
        />
        <CornerStats side="right" items={[["Aperçu", "phase 4"], ["Mode", "démo"]]} />
      </div>
    </ReactFlowProvider>
  );
}
