"use client";

import { createContext, useContext, useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { AlertTriangle, ArrowRightToLine, Check, Film, ImagePlus, Loader2, Lock, LockOpen, Minus, Plus, Sparkles, Wand2, X } from "lucide-react";
import { NodeCard, NodeChip, NodeField, NodePanel, NodeValue } from "@/components/nodes/node-card";
import { Port } from "@/components/nodes/port";
import { Thumb } from "@/components/bible/view-thumb";
import { IconPill, Pill } from "@/components/ui/pill";
import type { NodeRun } from "@/db/schema";
import { estimateCostUsd, formatUsd } from "@/lib/cost/estimate";
import { NODE_ORDER, NODE_SPECS, PORT_COLOR, PORT_LABEL, type GraphNodeData, type NodeType } from "@/lib/graph/types";
import type { ModelInfo } from "@/lib/models/registry";
import type { ProjectTree } from "@/lib/projects/queries";
import { assetUrl } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { ModelPicker } from "./model-picker";

/** What every node of the project canvas can read and do. */
export interface GraphContextValue {
  project: ProjectTree;
  models: ModelInfo[];
  runs: NodeRun[];
  updateData: (nodeId: string, patch: Partial<GraphNodeData>) => void;
  run: (nodeId: string, variants: number) => void;
  sendToShot: (runId: string, shotId: string) => void;
  upload: (nodeId: string, file: File) => void;
  /** Prompt enhancer: runs the LLM on the node's input. */
  enhance: (nodeId: string) => Promise<void>;
  /** Text currently arriving on a node's prompt input. */
  inputText: (nodeId: string) => string;
  /** Is something wired on this input? */
  wired: (nodeId: string, handle: string) => boolean;
  llm: { mock: boolean; estimatedUsdPerCall: number };
}

export const GraphContext = createContext<GraphContextValue | null>(null);
function useGraph() {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error("GraphContext missing");
  return ctx;
}

type Props = NodeProps & { data: GraphNodeData; type: NodeType };

function Ports({ type }: { type: NodeType }) {
  const { inputs, outputs } = NODE_SPECS[type];
  return (
    <div className="mb-2 flex items-start justify-between">
      <div>
        {inputs.map((p) => (
          <Port key={p.id} id={p.id} kind="target" color={PORT_COLOR[p.type]} label={p.label ?? PORT_LABEL[p.type]} />
        ))}
      </div>
      <div>
        {outputs.map((p) => (
          <Port key={p.id} id={p.id} kind="source" color={PORT_COLOR[p.type]} label={p.label ?? PORT_LABEL[p.type]} />
        ))}
      </div>
    </div>
  );
}

function Media({ assetId, kind, className }: { assetId: string; kind: "image" | "video"; className?: string }) {
  return kind === "video" ? (
    <video
      src={`${assetUrl(assetId)}#t=0.1`}
      preload="metadata"
      muted
      loop
      playsInline
      className={cn("object-cover", className)}
      onMouseEnter={(e) => void e.currentTarget.play()}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={assetUrl(assetId)} alt="" className={cn("object-cover", className)} />
  );
}

// --- Inputs ---------------------------------------------------------------------------

export function TextNode({ data, id, selected }: Props) {
  const { updateData } = useGraph();
  const [text, setText] = useState(data.text ?? "");
  return (
    <NodeCard title="Texte" width={260} glow={selected ? PORT_COLOR.text : undefined}>
      <NodePanel className="space-y-2">
        <Ports type="text" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (data.text ?? "") && updateData(id, { text })}
          rows={5}
          placeholder="Écris ton prompt…"
          className="nodrag nowheel w-full resize-none rounded-md bg-surface p-2 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
      </NodePanel>
    </NodeCard>
  );
}

function ImportNode({ data, id, type, selected }: Props) {
  const { upload } = useGraph();
  const video = type === "video";
  const [error, setError] = useState<string | null>(null);
  return (
    <NodeCard title={video ? "Vidéo" : "Image"} width={230} glow={selected ? PORT_COLOR[video ? "video" : "image"] : undefined}>
      <NodePanel className="space-y-2">
        <Ports type={type} />
        <label className="nodrag block cursor-pointer">
          {data.assetId ? (
            <Media assetId={data.assetId} kind={video ? "video" : "image"} className="aspect-video w-full rounded-md" />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-md border border-dashed text-[11px] text-muted-foreground">
              <span className="flex flex-col items-center gap-1">
                {video ? <Film className="size-4" /> : <ImagePlus className="size-4" />}
                {video ? "Choisir une vidéo" : "Choisir une image"}
              </span>
            </div>
          )}
          <input
            type="file"
            accept={video ? "video/*" : "image/*"}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (!f.type.startsWith(video ? "video/" : "image/")) {
                setError(video ? "Ce fichier n'est pas une vidéo" : "Ce fichier n'est pas une image");
                return;
              }
              setError(null);
              upload(id, f);
            }}
          />
        </label>
        {error && <div className="text-[10px] text-destructive">{error}</div>}
        {data.assetId && !error && <div className="text-[10px] text-muted-foreground">Clic sur le média pour le remplacer</div>}
      </NodePanel>
    </NodeCard>
  );
}

export const ImageNode = (p: Props) => <ImportNode {...p} type="image" />;

/** A bible reference: its images (all views) and its descriptor, injected word for word. */
export function ReferenceNode({ data, id, selected }: Props) {
  const { project, updateData } = useGraph();
  const ref = project.references.find((r) => r.id === data.referenceId);
  const views = ref?.variants[0]?.views ?? [];
  return (
    <NodeCard title="Référence" width={250} glow={selected ? PORT_COLOR.image : undefined}>
      <NodePanel className="space-y-2">
        <Ports type="reference" />
        <select
          value={data.referenceId ?? ""}
          onChange={(e) => updateData(id, { referenceId: e.target.value || undefined })}
          className="nodrag h-7 w-full rounded-md bg-surface px-1.5 text-[11px] outline-none"
        >
          <option value="">{project.references.length ? "Choisir dans la bible…" : "Bible vide (onglet Storyboard → Bible)"}</option>
          {project.references.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {ref && (
          <>
            {views.length > 0 ? (
              <div className="grid grid-cols-4 gap-1">
                {views.slice(0, 8).map((v, i) => (
                  <Thumb key={`${v.assetId}-${i}`} assetId={v.assetId} className="aspect-square w-full" />
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground">Aucune image : ajoute des vues dans sa fiche (Bible).</p>
            )}
            <p className="nowheel max-h-20 overflow-y-auto text-[10px] leading-relaxed text-muted-foreground">{ref.descriptor || "Pas de descripteur."}</p>
            <div className="text-[10px] text-muted-foreground">
              {views.length} image{views.length > 1 ? "s" : ""} → « références » · descripteur → « prompt »
            </div>
          </>
        )}
      </NodePanel>
    </NodeCard>
  );
}

/** What the model must avoid; only sent to models that accept a negative prompt. */
export function NegativeNode({ data, id, selected }: Props) {
  const { updateData } = useGraph();
  const [text, setText] = useState(data.text ?? "");
  return (
    <NodeCard title="Négatif" width={240} glow={selected ? PORT_COLOR.negative : undefined}>
      <NodePanel className="space-y-2">
        <Ports type="negative" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (data.text ?? "") && updateData(id, { text })}
          rows={3}
          placeholder="flou, texte, filigrane, mains déformées…"
          className="nodrag nowheel w-full resize-none rounded-md bg-surface p-2 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
        />
        <div className="text-[10px] text-muted-foreground">Envoyé seulement aux modèles marqués « négatif ».</div>
      </NodePanel>
    </NodeCard>
  );
}
export const VideoNode = (p: Props) => <ImportNode {...p} type="video" />;

// --- Prompt enhancer (LLM) -------------------------------------------------------------

export function PromptEnhancerNode({ data, id, selected }: Props) {
  const { updateData, enhance, inputText, llm } = useGraph();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(data.text ?? "");
  const [base, setBase] = useState(data.text ?? "");
  if (base !== (data.text ?? "")) {
    setBase(data.text ?? "");
    setDraft(data.text ?? "");
  }
  const input = inputText(id);
  const stale = !!data.text && data.source !== undefined && data.source !== input;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await enhance(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeCard
      title="Prompt enhancer"
      width={300}
      glow={busy ? PORT_COLOR.text : selected ? "var(--ring)" : undefined}
      action={
        <NodeChip className="nodrag" onClick={() => void run()} disabled={busy || !input}>
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />} {data.text ? "Relancer" : "Améliorer"}
        </NodeChip>
      }
    >
      <NodePanel className="space-y-2">
        <Ports type="promptEnhancer" />
        <NodeField label="LLM">
          <ModelPicker kinds={["llm"]} value={data.modelId} onChange={(modelId) => updateData(id, { modelId })} />
        </NodeField>
        <NodeField label="Pour">
          <select
            value={data.target ?? "image"}
            onChange={(e) => updateData(id, { target: e.target.value as "image" | "video" })}
            className="nodrag h-7 rounded-md bg-surface px-1.5 text-[11px] outline-none"
          >
            <option value="image">une image</option>
            <option value="video">une vidéo</option>
          </select>
        </NodeField>
        <input
          defaultValue={data.instruction ?? ""}
          key={data.instruction ?? ""}
          onBlur={(e) => e.target.value !== (data.instruction ?? "") && updateData(id, { instruction: e.target.value || undefined })}
          placeholder="Consigne (optionnel) : plus sombre, style anime…"
          className="nodrag h-7 w-full rounded-md bg-surface px-2 text-[11px] outline-none placeholder:text-muted-foreground/50"
        />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== (data.text ?? "") && updateData(id, { text: draft })}
          rows={6}
          placeholder={input ? "Clique sur « Améliorer » : le prompt enrichi apparaît ici, modifiable." : "Branche un node Texte sur l'entrée prompt."}
          className="nodrag nowheel w-full resize-none rounded-md bg-surface p-2 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
        />
        {stale && (
          <p className="text-[10px] text-origin-proposed">
            <AlertTriangle className="mr-1 inline size-3" />
            Le texte d&apos;entrée a changé : relance pour le prendre en compte.
          </p>
        )}
        {error && <p className="text-[10px] text-destructive">{error}</p>}
        <div className="text-[10px] text-muted-foreground">
          LLM · {llm.mock ? "gratuit (mock)" : `≈ ${formatUsd(llm.estimatedUsdPerCall)} par appel`}
        </div>
      </NodePanel>
    </NodeCard>
  );
}

// --- Generators ------------------------------------------------------------------------

function runSummary(runs: NodeRun[]) {
  return {
    running: runs.filter((t) => t.status === "queued" || t.status === "processing").length,
    failed: runs.filter((t) => t.status === "failed").length,
    done: runs.filter((t) => t.status === "completed").length,
  };
}

/** Optional link to the storyboard: pick a shot, the result becomes one of its takes. */
function SendToShot({ run }: { run: NodeRun }) {
  const { project, sendToShot } = useGraph();
  const [open, setOpen] = useState(false);
  const shots = project.sequences.flatMap((s, i) =>
    s.shots.map((sh, j) => ({ id: sh.id, number: `${i + 1}.${j + 1}`, label: sh.description.value })),
  );
  const sentTo = run.sentTakeId ? shots.find((s) => s.id === run.shotId) : undefined;
  return (
    <div className="nodrag relative mt-1.5">
      <Pill
        className="h-7 w-full justify-center text-[11px]"
        onClick={() => setOpen((o) => !o)}
        title="Optionnel : ajoute ce résultat aux prises d'un plan du storyboard"
      >
        {sentTo ? (
          <>
            <Check /> Envoyé au plan {sentTo.number}
          </>
        ) : (
          <>
            <ArrowRightToLine /> Envoyer au plan…
          </>
        )}
      </Pill>
      {open && (
        <div className="island nowheel absolute top-8 right-0 left-0 z-30 max-h-56 overflow-y-auto p-1">
          <div className="flex items-center justify-between px-1.5 py-1 text-[10px] text-muted-foreground">
            Choisis un plan
            <IconPill aria-label="Fermer" className="size-5 bg-transparent" onClick={() => setOpen(false)}>
              <X />
            </IconPill>
          </div>
          {shots.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Aucun plan : crée-en dans le storyboard.</p>}
          {shots.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setOpen(false);
                sendToShot(run.id, s.id);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-surface-2"
            >
              <span className="shrink-0 font-mono">{s.number}</span>
              <span className="truncate text-muted-foreground">{s.label || "Sans action"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GeneratorNode({ data, id, type, selected }: Props) {
  const { models, runs, updateData, run, wired } = useGraph();
  const spec = NODE_SPECS[type];
  const kind = spec.model!;
  const kinds = [kind, ...(spec.altModels ?? [])];
  const video = kind !== "t2i";
  const hasRefs = wired(id, "refs");
  const choices = models.filter((m) => kinds.includes(m.kind as typeof kind));
  // Same default as the server: an edit model when references are wired.
  const model =
    choices.find((m) => m.id === data.modelId) ??
    (hasRefs ? choices.find((m) => !!m.maxReferenceImages) : undefined) ??
    choices.find((m) => m.kind === kind);
  const issues = [
    hasRefs && model && !model.maxReferenceImages && "ce modèle n'accepte pas d'images de référence",
    !hasRefs && model?.kind === "i2i" && "ce modèle d'édition a besoin d'images sur « références »",
    wired(id, "negative") && model && !model.supportsNegativePrompt && "ce modèle n'accepte pas de prompt négatif",
    wired(id, "end") && model && !model.supportsStartEndFrames && "ce modèle n'accepte pas d'image de fin",
  ].filter((x): x is string => !!x);
  const durations = model?.durations ?? [];
  const duration = data.durationSec ?? durations[0] ?? 5;
  const [variants, setVariants] = useState(1);
  const unit = model ? estimateCostUsd(model, { seconds: video ? duration : 5 }) : 0;
  const mine = runs.filter((r) => r.nodeId === id);
  const status = runSummary(mine);
  const done = mine.filter((r) => r.status === "completed" && r.assetId);
  const shown = done.find((r) => r.id === data.selectedRunId) ?? done[0];
  const color = video ? "var(--port-video)" : "var(--port-image)";
  return (
    <NodeCard
      title={NODE_SPECS[type].label}
      width={280}
      glow={status.running ? color : selected ? "var(--ring)" : undefined}
      action={
        <NodeChip className="nodrag" onClick={() => run(id, variants)} disabled={!model}>
          <Sparkles /> {variants > 1 ? `Générer ×${variants}` : "Générer"}
        </NodeChip>
      }
    >
      <NodePanel>
        <Ports type={type} />
        <NodeField label="Modèle">
          <ModelPicker kinds={kinds} value={model?.id} onChange={(modelId) => updateData(id, { modelId })} />
        </NodeField>
        {issues.map((t) => (
          <p key={t} className="mb-1 text-[10px] text-origin-proposed">
            <AlertTriangle className="mr-1 inline size-3" />
            {t} : choisis-en un autre dans la liste (badges « réf », « négatif », « début + fin »).
          </p>
        ))}
        {video && durations.length > 0 && (
          <NodeField label="Durée">
            <select
              value={duration}
              onChange={(e) => updateData(id, { durationSec: Number(e.target.value) })}
              className="nodrag h-7 rounded-md bg-surface px-1.5 font-mono text-[11px] outline-none"
            >
              {durations.map((d) => (
                <option key={d} value={d}>
                  {d}s
                </option>
              ))}
            </select>
          </NodeField>
        )}
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
                title={data.seedLocked ? "Seed verrouillé : les variantes partent de ce seed (+1, +2…)" : "Seed aléatoire à chaque génération"}
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
          </div>
        </NodeField>
        <NodeField label="Coût estimé">
          <NodeValue mono className="justify-end">
            {formatUsd(unit * variants)}
          </NodeValue>
        </NodeField>
        <div className="mt-1 text-[10px] text-muted-foreground">
          {mine.length === 0 ? "Aucun résultat" : `${status.done} résultat${status.done > 1 ? "s" : ""}`}
          {status.running > 0 && <span className="text-port-image"> · {status.running} en cours</span>}
          {status.failed > 0 && (
            <span className="text-destructive" title={mine.find((r) => r.status === "failed")?.error ?? ""}>
              {" "}
              · {status.failed} échec
            </span>
          )}
        </div>
      </NodePanel>
      {mine.length > 0 && (
        <div className="mt-1.5 rounded-[10px] bg-surface-2 p-1.5">
          {shown?.assetId ? (
            <Media assetId={shown.assetId} kind={shown.kind} className="aspect-video w-full rounded-md" />
          ) : (
            <Thumb status={mine[0].status} className="aspect-video w-full" />
          )}
          <div className="nodrag nowheel mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
            {mine.map((r, i) => (
              <button
                key={r.id}
                type="button"
                title={`Résultat ${mine.length - i}${r.seed ? ` · seed ${r.seed}` : ""}${r.error ? ` — ${r.error}` : ""}${r.sentTakeId ? " · envoyé au storyboard" : ""}`}
                onClick={() => r.status === "completed" && updateData(id, { selectedRunId: r.id })}
                className={cn("relative shrink-0 rounded-md border-2", shown?.id === r.id ? "border-foreground/80" : "border-transparent")}
              >
                <Thumb assetId={r.kind === "image" ? r.assetId : undefined} status={r.status} className="h-8 w-12" />
                {r.kind === "video" && r.status === "completed" && (
                  <span className="absolute inset-0 grid place-items-center text-[8px] text-white">▶</span>
                )}
                {r.sentTakeId && <Check className="absolute top-0.5 right-0.5 size-2.5 rounded-full bg-origin-validated p-px text-black" />}
              </button>
            ))}
          </div>
          {shown && <SendToShot run={shown} />}
        </div>
      )}
    </NodeCard>
  );
}

export const TextToImageNode = (p: Props) => <GeneratorNode {...p} type="textToImage" />;
export const TextToVideoNode = (p: Props) => <GeneratorNode {...p} type="textToVideo" />;
export const ImageToVideoNode = (p: Props) => <GeneratorNode {...p} type="imageToVideo" />;
export const VideoToVideoNode = (p: Props) => <GeneratorNode {...p} type="videoToVideo" />;

export const graphNodeTypes = {
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  reference: ReferenceNode,
  negative: NegativeNode,
  promptEnhancer: PromptEnhancerNode,
  textToImage: TextToImageNode,
  textToVideo: TextToVideoNode,
  imageToVideo: ImageToVideoNode,
  videoToVideo: VideoToVideoNode,
};

// --- Palette ---------------------------------------------------------------------------

const GROUP: Record<NodeType, string> = {
  text: "Entrées",
  image: "Entrées",
  video: "Entrées",
  reference: "Entrées",
  negative: "Texte",
  promptEnhancer: "Texte",
  textToImage: "Génération",
  textToVideo: "Génération",
  imageToVideo: "Génération",
  videoToVideo: "Génération",
};

export function NodePalette({
  x,
  y,
  onPick,
  onClose,
  types = NODE_ORDER,
  title = "Ajouter un node",
}: {
  x: number;
  y: number;
  onPick: (type: NodeType) => void;
  onClose: () => void;
  /** Only these node types (e.g. those that can take a dragged link). */
  types?: NodeType[];
  title?: string;
}) {
  return (
    <div className="island absolute z-30 w-60 p-1.5" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center justify-between px-1.5 text-[11px] text-muted-foreground">
        {title}
        <IconPill aria-label="Fermer" className="size-6 bg-transparent" onClick={onClose}>
          <X />
        </IconPill>
      </div>
      {types.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Aucun node ne prend ce type de lien.</p>}
      {types.map((type, i) => (
        <div key={type}>
          {(i === 0 || GROUP[types[i - 1]] !== GROUP[type]) && (
            <div className="mt-1 px-2 pt-1 text-[9px] tracking-wide text-muted-foreground/70 uppercase">{GROUP[type]}</div>
          )}
          <button type="button" onClick={() => onPick(type)} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
            <div className="text-xs">{NODE_SPECS[type].label}</div>
            <div className="text-[10px] text-muted-foreground">{NODE_SPECS[type].description}</div>
          </button>
        </div>
      ))}
    </div>
  );
}
