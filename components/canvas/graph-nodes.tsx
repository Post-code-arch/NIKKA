"use client";

import { createContext, useContext, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { Check, ChevronDown, Library, Lock, LockOpen, Minus, Plus, Sparkles, X } from "lucide-react";
import { NodeCard, NodeChip, NodeField, NodePanel, NodeValue } from "@/components/nodes/node-card";
import { Port } from "@/components/nodes/port";
import { Thumb } from "@/components/bible/view-thumb";
import { IconPill, Pill } from "@/components/ui/pill";
import type { Take } from "@/db/schema";
import { estimateCostUsd, formatUsd } from "@/lib/cost/estimate";
import { NODE_SPECS, PORT_COLOR, portsOf, type GraphNodeData, type NodeType } from "@/lib/graph/types";
import type { ModelInfo } from "@/lib/models/registry";
import type { ShotPromptPreview } from "@/lib/prompt/shot";
import type { ProjectTree, ShotWithTakes } from "@/lib/projects/queries";
import { TAG_COLOR_VAR, TAG_LABEL, VIEW_LABEL } from "@/lib/refs/views";
import { assetUrl } from "@/lib/store/api";
import { cn } from "@/lib/utils";

/** What every node of the open shot graph can read and do. */
export interface GraphContextValue {
  project: ProjectTree;
  shot: ShotWithTakes;
  models: ModelInfo[];
  preview: ShotPromptPreview | null;
  updateData: (nodeId: string, patch: Partial<GraphNodeData>) => void;
  run: (nodeId: string, variants: number) => void;
  selectTake: (takeId: string, nodeId: string) => void;
  openReference: (referenceId: string) => void;
  promoteReference: (referenceId: string) => void;
}

export const GraphContext = createContext<GraphContextValue | null>(null);
function useGraph() {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("GraphContext missing");
  return ctx;
}

type Props = NodeProps & { data: GraphNodeData; type: NodeType };

function Ports({ type, data }: { type: NodeType; data: GraphNodeData }) {
  const { inputs, outputs } = portsOf(type, data);
  return (
    <div className="mb-2 flex items-start justify-between">
      <div>
        {inputs.map((p) => (
          <Port key={p.id} id={p.id} kind="target" color={PORT_COLOR[p.type]} label={p.label ?? (p.type === "text" ? "prompt" : p.type === "ref" ? "références" : p.type)} />
        ))}
      </div>
      <div>
        {outputs.map((p) => (
          <Port key={p.id} id={p.id} kind="source" color={PORT_COLOR[p.type]} label={p.label ?? (p.type === "text" ? "prompt" : p.type)} />
        ))}
      </div>
    </div>
  );
}

// --- Reference -----------------------------------------------------------------

export function ReferenceNode({ data, selected }: Props) {
  const { project, openReference, promoteReference } = useGraph();
  const ref = project.references.find((r) => r.id === data.referenceId);
  const color = ref ? TAG_COLOR_VAR[ref.tag] : "var(--tag-free)";
  const views = ref?.variants[0]?.views ?? [];
  return (
    <NodeCard title="Référence" width={230} glow={selected ? color : undefined}>
      <NodePanel className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{ref?.name ?? "Référence supprimée"}</span>
          </span>
          <Port id="ref" kind="source" color={color} />
        </div>
        {ref && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {TAG_LABEL[ref.tag]} · {ref.scope === "bible" ? "bible" : "locale"} · {views.length} vue{views.length > 1 ? "s" : ""}
          </div>
        )}
        {views.length > 0 && (
          <div className="flex gap-1">
            {views.slice(0, 4).map((v, i) => (
              <Thumb key={`${v.assetId}-${i}`} assetId={v.assetId} className="size-10" />
            ))}
          </div>
        )}
        {ref && (
          <div className="nodrag flex gap-1">
            <Pill className="h-7 px-2 text-[10px]" onClick={() => openReference(ref.id)}>
              Fiche
            </Pill>
            {ref.scope === "local" && (
              <Pill className="h-7 px-2 text-[10px]" onClick={() => promoteReference(ref.id)}>
                <Library /> Ajouter à la bible
              </Pill>
            )}
          </div>
        )}
      </NodePanel>
    </NodeCard>
  );
}

// --- RefSelector -------------------------------------------------------------------

export function RefSelectorNode({ data, id }: Props) {
  const { preview, updateData } = useGraph();
  const picked = preview?.references?.picked ?? [];
  const manual = data.manualViews;
  const shown = manual ? picked.filter((p) => manual.includes(p.assetId)) : picked;
  return (
    <NodeCard title="Sélection des vues" width={250}>
      <NodePanel>
        <Ports type="refSelector" data={data} />
        {picked.length === 0 && <p className="text-[10px] text-muted-foreground">Aucune vue : ajoute des images aux références.</p>}
        <div className="nodrag grid grid-cols-4 gap-1">
          {picked.map((p, i) => {
            const on = !manual || manual.includes(p.assetId);
            return (
              <button
                key={`${p.assetId}-${i}`}
                type="button"
                title={`${p.refName} · ${VIEW_LABEL[p.view]} — ${p.reason}. Clic pour l'exclure / l'inclure.`}
                onClick={() => {
                  const base = manual ?? picked.map((x) => x.assetId);
                  const next = on ? base.filter((a) => a !== p.assetId) : [...base, p.assetId];
                  updateData(id, { manualViews: next.length === picked.length ? undefined : next });
                }}
                className={cn("relative rounded-md", !on && "opacity-30")}
              >
                <Thumb assetId={p.assetId} className="aspect-square w-full" />
                <span className="block truncate text-[8px] text-muted-foreground">{VIEW_LABEL[p.view]}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {shown.length}/{preview?.references?.maxSlots ?? "—"} envoyées · {manual ? "choix manuel" : "selon l'échelle"}
        </div>
      </NodePanel>
    </NodeCard>
  );
}

// --- PromptBuilder ------------------------------------------------------------------

export function PromptBuilderNode({ data, id }: Props) {
  const { preview, updateData, shot } = useGraph();
  const [text, setText] = useState(data.override ?? "");
  const free = data.override !== undefined;
  return (
    <NodeCard title="Prompt" width={270}>
      <NodePanel className="space-y-2">
        <Ports type="promptBuilder" data={data} />
        {free ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== (data.override ?? "") && updateData(id, { override: text })}
            rows={3}
            placeholder={shot.description.value || "Prompt libre…"}
            className="nodrag nowheel w-full resize-none rounded-md bg-surface p-2 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
          />
        ) : (
          <p className="nowheel max-h-28 overflow-y-auto text-[11px] leading-relaxed text-muted-foreground">
            {preview?.keyframe.prompt || "Écris l'action du plan dans la fiche."}
          </p>
        )}
        <div className="text-[10px] text-muted-foreground">Descripteurs + {free ? "texte libre" : "action"} + caméra + look</div>
      </NodePanel>
    </NodeCard>
  );
}

// --- Generation nodes -----------------------------------------------------------------

function takeStatusSummary(takes: Take[]) {
  const running = takes.filter((t) => t.status === "queued" || t.status === "processing").length;
  const failed = takes.filter((t) => t.status === "failed").length;
  const done = takes.filter((t) => t.status === "completed").length;
  return { running, failed, done };
}

function GenerationNode({ data, id, type, selected }: Props) {
  const { models, shot, updateData, run } = useGraph();
  const kind = type === "imageEdit" ? "i2i" : type === "videoGen" ? "i2v" : "t2i";
  const choices = models.filter((m) => m.kind === kind);
  const model = choices.find((m) => m.id === data.modelId) ?? choices[0];
  const [variants, setVariants] = useState(1);
  const unit = model ? estimateCostUsd(model, { seconds: shot.durationSec }) : 0;
  const mine = shot.takes.filter((t) => t.nodeId === id);
  const status = takeStatusSummary(mine);
  const glow = status.running ? (type === "videoGen" ? "var(--port-video)" : "var(--port-image)") : selected ? "var(--ring)" : undefined;
  return (
    <NodeCard
      title={NODE_SPECS[type].label}
      width={280}
      glow={glow}
      action={
        <NodeChip className="nodrag" onClick={() => run(id, variants)} disabled={!model}>
          <Sparkles /> {variants > 1 ? `Générer ×${variants}` : "Générer"}
        </NodeChip>
      }
    >
      <NodePanel>
        <Ports type={type} data={data} />
        <NodeField label="Modèle">
          <select
            value={model?.id ?? ""}
            onChange={(e) => updateData(id, { modelId: e.target.value })}
            className="nodrag h-7 max-w-36 rounded-md bg-surface px-1.5 text-[11px] outline-none"
          >
            {choices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </NodeField>
        {model?.supportsSeed && (
          <NodeField label="Seed">
            <div className="nodrag flex items-center gap-1">
              <input
                type="number"
                value={data.seed ?? ""}
                placeholder="aléatoire"
                onChange={(e) => updateData(id, { seed: e.target.value === "" ? undefined : Math.trunc(Number(e.target.value)) })}
                className="h-7 w-24 rounded-md bg-surface px-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/50"
              />
              <IconPill
                aria-label={data.seedLocked ? "Déverrouiller le seed" : "Verrouiller le seed"}
                title={data.seedLocked ? "Seed verrouillé : les variantes partent de ce seed (+1, +2…)" : "Seed aléatoire à chaque prise"}
                className={cn("size-7", data.seedLocked && "bg-foreground text-background hover:bg-foreground hover:text-background")}
                onClick={() => updateData(id, { seedLocked: !data.seedLocked })}
              >
                {data.seedLocked ? <Lock /> : <LockOpen />}
              </IconPill>
            </div>
          </NodeField>
        )}
        <NodeField label="Variantes">
          <div className="nodrag flex items-center gap-1">
            <NodeValue className="min-w-0 cursor-pointer px-1.5" onClick={() => setVariants((v) => Math.max(1, v - 1))}>
              <Minus />
            </NodeValue>
            <NodeValue mono className="min-w-9 justify-center">
              {variants}
            </NodeValue>
            <NodeValue className="min-w-0 cursor-pointer px-1.5" onClick={() => setVariants((v) => Math.min(8, v + 1))}>
              <Plus />
            </NodeValue>
            <Pill className="h-7 px-2 font-mono text-[10px]" onClick={() => setVariants(4)}>
              ×4
            </Pill>
          </div>
        </NodeField>
        <NodeField label="Coût estimé">
          <NodeValue mono className="justify-end">
            {formatUsd(unit * variants)}
          </NodeValue>
        </NodeField>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {mine.length === 0 ? "Aucune prise" : `${status.done} terminée${status.done > 1 ? "s" : ""}`}
            {status.running > 0 && <span className="text-port-image"> · {status.running} en cours</span>}
            {status.failed > 0 && <span className="text-destructive"> · {status.failed} échec</span>}
          </span>
          {type === "videoGen" && <span>{shot.durationSec}s</span>}
        </div>
      </NodePanel>
    </NodeCard>
  );
}

export const ImageGenNode = (p: Props) => <GenerationNode {...p} type="imageGen" />;
export const ImageEditNode = (p: Props) => <GenerationNode {...p} type="imageEdit" />;
export const VideoGenNode = (p: Props) => <GenerationNode {...p} type="videoGen" />;

// --- FrameExtract ----------------------------------------------------------------------

export function FrameExtractNode({ data, id }: Props) {
  const { updateData } = useGraph();
  return (
    <NodeCard title="Extraction d'image" width={240}>
      <NodePanel>
        <Ports type="frameExtract" data={data} />
        <NodeField label="Source">
          <select
            value={data.source ?? "input"}
            onChange={(e) => updateData(id, { source: e.target.value as "input" | "previous_shot" })}
            className="nodrag h-7 rounded-md bg-surface px-1.5 text-[11px] outline-none"
          >
            <option value="previous_shot">Plan précédent</option>
            <option value="input">Entrée vidéo</option>
          </select>
        </NodeField>
        <NodeField label="Image">
          <select
            value={data.which ?? "last"}
            onChange={(e) => updateData(id, { which: e.target.value as "last" | "first" })}
            className="nodrag h-7 rounded-md bg-surface px-1.5 text-[11px] outline-none"
          >
            <option value="last">Dernière</option>
            <option value="first">Première</option>
          </select>
        </NodeField>
      </NodePanel>
    </NodeCard>
  );
}

// --- Take --------------------------------------------------------------------------------

export function TakeNode({ data, id }: Props) {
  const { shot, project, selectTake } = useGraph();
  const video = data.stage === "video";
  const takes = shot.takes.filter((t) => (video ? t.stage === "video" : t.stage !== "video"));
  const completed = takes.filter((t) => t.status === "completed");
  const retained = completed.find((t) => t.id === data.takeId) ?? completed.find((t) => t.id === shot.selectedTakeId) ?? completed[0];
  const asset = retained?.assetId ? project.assets[retained.assetId] : undefined;
  return (
    <NodeCard title={video ? "Prise · vidéo" : "Prise · image clé"} width={260}>
      <NodePanel className="p-2">
        <Ports type="take" data={data} />
        <div className="relative aspect-video overflow-hidden rounded-md bg-surface">
          {asset ? (
            asset.kind === "video" ? (
              <video src={`${assetUrl(asset.id)}#t=0.1`} preload="metadata" muted loop playsInline className="size-full object-cover"
                onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assetUrl(asset.id)} alt="" className="size-full object-cover" />
            )
          ) : (
            <div className="grid size-full place-items-center text-[10px] text-muted-foreground">Pas encore de prise</div>
          )}
        </div>
        {takes.length > 0 && (
          <div className="nodrag nowheel mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
            {takes.map((t, i) => (
              <button
                key={t.id}
                type="button"
                title={`Prise ${takes.length - i}${t.seed ? ` · seed ${t.seed}` : ""}${t.error ? ` — ${t.error}` : ""}`}
                onClick={() => t.status === "completed" && selectTake(t.id, id)}
                className={cn("relative shrink-0 rounded-md border-2", retained?.id === t.id ? "border-foreground/80" : "border-transparent")}
              >
                <Thumb assetId={t.assetId} status={t.status} className="h-9 w-14" />
                {retained?.id === t.id && <Check className="absolute top-0.5 right-0.5 size-3 rounded-full bg-foreground p-0.5 text-background" />}
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          {completed.length} prise{completed.length > 1 ? "s" : ""} · clic pour retenir
        </div>
      </NodePanel>
    </NodeCard>
  );
}

export const graphNodeTypes = {
  reference: ReferenceNode,
  refSelector: RefSelectorNode,
  promptBuilder: PromptBuilderNode,
  imageGen: ImageGenNode,
  imageEdit: ImageEditNode,
  videoGen: VideoGenNode,
  frameExtract: FrameExtractNode,
  take: TakeNode,
};

// --- Palette ---------------------------------------------------------------------------

export const PALETTE: { type: NodeType; data?: GraphNodeData }[] = [
  { type: "reference" },
  { type: "refSelector" },
  { type: "promptBuilder" },
  { type: "promptBuilder", data: { override: "" } },
  { type: "imageGen" },
  { type: "imageEdit" },
  { type: "videoGen" },
  { type: "frameExtract", data: { source: "previous_shot", which: "last" } },
  { type: "take", data: { stage: "keyframe" } },
  { type: "take", data: { stage: "video" } },
];

export function paletteLabel(item: (typeof PALETTE)[number]) {
  if (item.type === "promptBuilder" && item.data?.override !== undefined) return "Prompt libre";
  if (item.type === "take") return item.data?.stage === "video" ? "Prise · vidéo" : "Prise · image clé";
  return NODE_SPECS[item.type].label;
}

export function NodePalette({
  x,
  y,
  onPick,
  onClose,
  references,
}: {
  x: number;
  y: number;
  onPick: (item: (typeof PALETTE)[number]) => void;
  onClose: () => void;
  references: { id: string; name: string; tag: keyof typeof TAG_COLOR_VAR }[];
}) {
  const [refOpen, setRefOpen] = useState(false);
  return (
    <div className="island absolute z-30 w-60 p-1.5" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] text-muted-foreground">
        Ajouter un node
        <IconPill aria-label="Fermer" className="size-6 bg-transparent" onClick={onClose}>
          <X />
        </IconPill>
      </div>
      {PALETTE.map((item, i) =>
        item.type === "reference" ? (
          <div key={i}>
            <button type="button" onClick={() => setRefOpen((o) => !o)} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2">
              Référence <ChevronDown className="size-3 text-muted-foreground" />
            </button>
            {refOpen && (
              <div className="mb-1 ml-2 border-l pl-1">
                {references.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Aucune référence dans le projet</p>}
                {references.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => onPick({ type: "reference", data: { referenceId: r.id } })}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] hover:bg-surface-2"
                  >
                    <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[r.tag] }} />
                    {r.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button key={i} type="button" onClick={() => onPick(item)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2">
            {paletteLabel(item)}
          </button>
        ),
      )}
    </div>
  );
}
