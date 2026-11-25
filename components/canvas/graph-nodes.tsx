"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { ArrowRightToLine, Check, ChevronDown, ImagePlus, Library, Lock, LockOpen, Minus, Plus, Sparkles, X } from "lucide-react";
import { NodeCard, NodeChip, NodeField, NodePanel, NodeValue } from "@/components/nodes/node-card";
import { Port } from "@/components/nodes/port";
import { Thumb } from "@/components/bible/view-thumb";
import { IconPill, Pill } from "@/components/ui/pill";
import type { NodeRun } from "@/db/schema";
import { estimateCostUsd, formatUsd } from "@/lib/cost/estimate";
import { NODE_SPECS, PORT_COLOR, incoming, outgoing, portsOf, type GraphNodeData, type NodeType, type ShotGraphData } from "@/lib/graph/types";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import type { Selection } from "@/lib/refs/select";
import { api } from "@/lib/store/api";
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
  runs: NodeRun[];
  /** Current graph (nodes and links) as edited. */
  graph: ShotGraphData;
  run: (nodeId: string, variants: number) => void;
  sendToShot: (runId: string) => void;
  uploadImage: (nodeId: string, file: File) => void;
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
  const { graph, shot, models, updateData } = useGraph();
  // Its own selection: references wired in, the shot's camera, slots of the edit model it feeds.
  const refIds = incoming(graph, id, "refs").map((n) => n.data.referenceId).filter((x): x is string => !!x);
  const editNode = outgoing(graph, id).find((n) => n.type === "imageEdit");
  const editModel = models.find((m) => m.id === editNode?.data.modelId) ?? models.find((m) => m.kind === "i2i");
  const maxSlots = editModel?.maxReferenceImages ?? 4;
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  const [selection, setSelection] = useState<Selection | null>(null);
  const key = JSON.stringify([refIds, camera.scale, camera.angle, maxSlots]);
  useEffect(() => {
    let stale = false;
    void api<Selection>("/api/refs/select", {
      body: { refs: refIds.map((referenceId) => ({ referenceId })), scale: camera.scale, angle: camera.angle, maxSlots },
    }).then((r) => {
      if (!stale) setSelection(r);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const picked = selection?.picked ?? [];
  const manual = data.manualViews;
  const shown = manual ? picked.filter((p) => manual.includes(p.assetId)) : picked;
  return (
    <NodeCard title="Sélection des vues" width={250}>
      <NodePanel>
        <Ports type="refSelector" data={data} />
        {picked.length === 0 && (
          <p className="text-[10px] text-muted-foreground">
            {refIds.length === 0 ? "Branche des références." : "Aucune vue : ajoute des images aux références."}
          </p>
        )}
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
          {shown.length}/{maxSlots} envoyées · {manual ? "choix manuel" : "selon l'échelle du plan"}
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

function runSummary(runs: NodeRun[]) {
  return {
    running: runs.filter((t) => t.status === "queued" || t.status === "processing").length,
    failed: runs.filter((t) => t.status === "failed").length,
    done: runs.filter((t) => t.status === "completed").length,
  };
}

function Media({ assetId, kind, className }: { assetId: string; kind: "image" | "video"; className?: string }) {
  return kind === "video" ? (
    <video src={`${assetUrl(assetId)}#t=0.1`} preload="metadata" muted loop playsInline className={cn("object-cover", className)}
      onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={assetUrl(assetId)} alt="" className={cn("object-cover", className)} />
  );
}

function GenerationNode({ data, id, type, selected }: Props) {
  const { models, shot, updateData, run } = useGraph();
  const kind = type === "imageEdit" ? "i2i" : type === "videoGen" ? "i2v" : "t2i";
  const choices = models.filter((m) => m.kind === kind);
  const model = choices.find((m) => m.id === data.modelId) ?? choices[0];
  const [variants, setVariants] = useState(1);
  const unit = model ? estimateCostUsd(model, { seconds: shot.durationSec }) : 0;
  const { runs, sendToShot } = useGraph();
  const mine = runs.filter((r) => r.nodeId === id);
  const status = runSummary(mine);
  const done = mine.filter((r) => r.status === "completed" && r.assetId);
  const selectedRun = done.find((r) => r.id === data.selectedRunId) ?? done[0];
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
            {mine.length === 0 ? "Aucun résultat" : `${status.done} résultat${status.done > 1 ? "s" : ""}`}
            {status.running > 0 && <span className="text-port-image"> · {status.running} en cours</span>}
            {status.failed > 0 && <span className="text-destructive" title={mine.find((r) => r.status === "failed")?.error ?? ""}> · {status.failed} échec</span>}
          </span>
          {type === "videoGen" && <span>{shot.durationSec}s</span>}
        </div>
      </NodePanel>
      {mine.length > 0 && (
        <div className="mt-1.5 rounded-[10px] bg-surface-2 p-1.5">
          {selectedRun?.assetId ? (
            <Media assetId={selectedRun.assetId} kind={selectedRun.kind} className="aspect-video w-full rounded-md" />
          ) : (
            <Thumb status={mine[0].status} className="aspect-video w-full" />
          )}
          <div className="nodrag nowheel mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
            {mine.map((r, i) => (
              <button
                key={r.id}
                type="button"
                title={`Résultat ${mine.length - i}${r.seed ? ` · seed ${r.seed}` : ""}${r.error ? ` — ${r.error}` : ""}${r.sentTakeId ? " · envoyé au plan" : ""}`}
                onClick={() => r.status === "completed" && updateData(id, { selectedRunId: r.id })}
                className={cn("relative shrink-0 rounded-md border-2", selectedRun?.id === r.id ? "border-foreground/80" : "border-transparent")}
              >
                <Thumb assetId={r.kind === "image" ? r.assetId : undefined} status={r.status} className="h-8 w-12" />
                {r.kind === "video" && r.status === "completed" && <span className="absolute inset-0 grid place-items-center text-[8px] text-white">▶</span>}
                {r.sentTakeId && <Check className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-origin-validated p-px text-black" />}
              </button>
            ))}
          </div>
          {selectedRun && (
            <Pill
              className="nodrag mt-1.5 h-7 w-full justify-center text-[11px]"
              disabled={!!selectedRun.sentTakeId}
              onClick={() => sendToShot(selectedRun.id)}
              title="Ajoute ce résultat aux prises du plan dans le storyboard"
            >
              {selectedRun.sentTakeId ? (
                <>
                  <Check /> Envoyé au plan
                </>
              ) : (
                <>
                  <ArrowRightToLine /> Envoyer au plan
                </>
              )}
            </Pill>
          )}
        </div>
      )}
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

export function TakeNode({ data }: Props) {
  const { shot, project } = useGraph();
  const video = data.stage === "video";
  const completed = shot.takes.filter((t) => t.status === "completed" && (video ? t.stage === "video" : t.stage !== "video"));
  const retained = completed.find((t) => t.id === shot.selectedTakeId) ?? completed[0];
  const asset = retained?.assetId ? project.assets[retained.assetId] : undefined;
  return (
    <NodeCard title={video ? "Prise du plan · vidéo" : "Prise du plan · image"} width={240}>
      <NodePanel className="p-2">
        <Ports type="take" data={data} />
        <div className="relative aspect-video overflow-hidden rounded-md bg-surface">
          {asset ? (
            <Media assetId={asset.id} kind={asset.kind} className="size-full" />
          ) : (
            <div className="grid size-full place-items-center px-2 text-center text-[10px] text-muted-foreground">
              Aucune prise {video ? "vidéo" : "image"} retenue dans le storyboard
            </div>
          )}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">La prise retenue dans le storyboard</div>
      </NodePanel>
    </NodeCard>
  );
}

// --- Text & imported image ---------------------------------------------------------------

export function TextNode({ data, id }: Props) {
  const { updateData } = useGraph();
  const [text, setText] = useState(data.text ?? "");
  return (
    <NodeCard title="Texte" width={260}>
      <NodePanel className="space-y-2">
        <div className="flex justify-end">
          <Port id="prompt" kind="source" color={PORT_COLOR.text} label="prompt" />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (data.text ?? "") && updateData(id, { text })}
          rows={4}
          placeholder="Écris ton prompt…"
          className="nodrag nowheel w-full resize-none rounded-md bg-surface p-2 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
      </NodePanel>
    </NodeCard>
  );
}

export function ImageInputNode({ data, id }: Props) {
  const { uploadImage } = useGraph();
  return (
    <NodeCard title="Image importée" width={220}>
      <NodePanel className="space-y-2">
        <div className="flex justify-end">
          <Port id="image" kind="source" color={PORT_COLOR.image} label="image" />
        </div>
        <label className="nodrag block cursor-pointer">
          {data.assetId ? (
            <Thumb assetId={data.assetId} className="aspect-video w-full" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-md border border-dashed text-[11px] text-muted-foreground">
              <span className="flex flex-col items-center gap-1">
                <ImagePlus className="size-4" /> Choisir une image
              </span>
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(id, f);
            }}
          />
        </label>
        {data.assetId && <div className="text-[10px] text-muted-foreground">Clic sur l&apos;image pour la remplacer</div>}
      </NodePanel>
    </NodeCard>
  );
}

export const graphNodeTypes = {
  text: TextNode,
  imageInput: ImageInputNode,
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

export const PALETTE: { type: NodeType; data?: GraphNodeData; group: string }[] = [
  { type: "text", data: { text: "" }, group: "Entrées" },
  { type: "imageInput", group: "Entrées" },
  { type: "reference", group: "Entrées" },
  { type: "take", data: { stage: "keyframe" }, group: "Entrées" },
  { type: "take", data: { stage: "video" }, group: "Entrées" },
  { type: "promptBuilder", group: "Préparation" },
  { type: "refSelector", group: "Préparation" },
  { type: "frameExtract", data: { source: "previous_shot", which: "last" }, group: "Préparation" },
  { type: "imageGen", group: "Génération" },
  { type: "imageEdit", group: "Génération" },
  { type: "videoGen", group: "Génération" },
];

export function paletteLabel(item: (typeof PALETTE)[number]) {
  if (item.type === "take") return item.data?.stage === "video" ? "Prise du plan · vidéo" : "Prise du plan · image";
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
      {PALETTE.map((item, i) => (
        <div key={i}>
        {(i === 0 || PALETTE[i - 1].group !== item.group) && (
          <div className="mt-1 px-2 pt-1 text-[9px] tracking-wide text-muted-foreground/70 uppercase">{item.group}</div>
        )}
        {item.type === "reference" ? (
          <div>
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
                    onClick={() => onPick({ type: "reference", data: { referenceId: r.id }, group: "Entrées" })}
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
          <button type="button" onClick={() => onPick(item)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2">
            {paletteLabel(item)}
          </button>
        )}
        </div>
      ))}
    </div>
  );
}
