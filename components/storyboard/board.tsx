"use client";

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clapperboard, Film, FolderPlus, Image as ImageIcon, LayoutGrid, Pencil, Play, Plus, Rows3, X } from "lucide-react";
import { CornerStats } from "@/components/shell/corner-stats";
import { Button } from "@/components/ui/button";
import { Island, Pill } from "@/components/ui/pill";
import type { ShotStatus } from "@/db/schema";
import type { CameraCapabilities } from "@/lib/camera/phrasing";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { formatUsd } from "@/lib/cost/estimate";
import type { ProjectTree, SequenceTree, ShotWithTakes } from "@/lib/projects/queries";
import type { BatchStage } from "@/lib/storyboard/ops";
import { api, assetUrl } from "@/lib/store/api";
import { defaultModels, useModels } from "@/lib/store/models";
import { inFlightCount, useProjectStore } from "@/lib/store/project-store";
import { useUiStore, type StoryboardFilters } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { MovementIcon, ScaleIcon } from "@/components/camera/icons";
import { Animatic, shownTake } from "./animatic";
import { BatchDialog, STAGE_LABEL } from "./batch-dialog";
import { ShotCard, STATUS_LABEL } from "./shot-card";
import { ShotInspector } from "./shot-inspector";

/** Timeline scale: pixels per second. */
const PX_PER_SEC = 34;

type BatchRequest = { shotIds: string[]; stage: BatchStage; title: string };

function matches(shot: ShotWithTakes, seq: SequenceTree, f: StoryboardFilters) {
  if (f.status && shot.status !== f.status) return false;
  if (f.characterId && !shot.refIds.includes(f.characterId)) return false;
  if (f.locationId && !shot.refIds.includes(f.locationId) && seq.locationRefId !== f.locationId) return false;
  return true;
}

const STAGE_ICON: Record<BatchStage, React.ReactNode> = { sketch: <Pencil />, keyframe: <ImageIcon />, video: <Film /> };

// --- sortable wrappers ------------------------------------------------------------------

function SortableCard({ id, disabled, children }: { id: string; disabled: boolean; children: (handle: React.HTMLAttributes<HTMLElement>) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && "z-20 opacity-60")}>
      {children(disabled ? {} : { ...attributes, ...listeners })}
    </div>
  );
}

function SequenceDrop({ id, className, children }: { id: string; className?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `seq:${id}` });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && "rounded-lg bg-surface-2/40")}>
      {children}
    </div>
  );
}

/** Insert a shot between two others. */
function InsertGap({ seqId, index, onChanged, tall }: { seqId: string; index: number; onChanged: () => void; tall?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Insérer un plan ici"
      title="Insérer un plan ici"
      onClick={() => void api(`/api/sequences/${seqId}/shots`, { body: { index } }).then(onChanged)}
      className={cn(
        "group flex w-3 shrink-0 items-center justify-center self-stretch opacity-0 transition-opacity hover:opacity-100 focus:opacity-100",
        tall ? "mt-8" : "",
      )}
    >
      <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-muted-foreground group-hover:text-foreground">
        <Plus className="size-3" />
      </span>
    </button>
  );
}

// --- sequence -------------------------------------------------------------------------------

function SequenceHeader({
  seq,
  index,
  visible,
  onChanged,
  onBatch,
  onAnimatic,
}: {
  seq: SequenceTree;
  index: number;
  visible: ShotWithTakes[];
  onChanged: () => void;
  onBatch: (r: BatchRequest) => void;
  onAnimatic: () => void;
}) {
  const [title, setTitle] = useState(seq.title.value);
  const duration = seq.shots.reduce((n, s) => n + s.durationSec, 0);
  const ids = visible.map((s) => s.id);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() =>
          title !== seq.title.value &&
          void api(`/api/sequences/${seq.id}`, { method: "PATCH", body: { title: { value: title, origin: "validated" } } }).then(onChanged)
        }
        className="min-w-0 rounded-md bg-transparent px-1.5 py-0.5 text-sm outline-none focus:bg-surface-2"
      />
      <span className="font-mono text-[10px] text-muted-foreground">
        {seq.shots.length} plans · {Math.round(duration)}s
      </span>
      <Pill className="h-7 text-[11px]" onClick={() => void api(`/api/sequences/${seq.id}/shots`, { body: {} }).then(onChanged)}>
        <Plus /> Plan
      </Pill>
      <span className="mx-1 h-4 w-px bg-border" />
      {(["sketch", "keyframe", "video"] as const).map((stage) => (
        <Pill
          key={stage}
          className="h-7 text-[11px]"
          disabled={ids.length === 0}
          onClick={() => onBatch({ shotIds: ids, stage, title: `séquence ${index + 1}` })}
          title={`${STAGE_LABEL[stage]} de toute la séquence (coût total confirmé avant)`}
        >
          {STAGE_ICON[stage]} {STAGE_LABEL[stage]}
        </Pill>
      ))}
      <Pill className="h-7 text-[11px]" disabled={seq.shots.length === 0} onClick={onAnimatic} title="Lire la séquence aux durées des plans">
        <Play /> Animatique
      </Pill>
    </div>
  );
}

function TimelineBlock({ shot, number, project, handle, picked, onTogglePick }: {
  shot: ShotWithTakes;
  number: string;
  project: ProjectTree;
  handle: React.HTMLAttributes<HTMLElement>;
  picked: boolean;
  onTogglePick: () => void;
}) {
  const selectShot = useUiStore((s) => s.selectShot);
  const selectedShotId = useUiStore((s) => s.selectedShotId);
  const take = shownTake(shot);
  const asset = take?.assetId ? project.assets[take.assetId] : undefined;
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  return (
    <div
      {...handle}
      onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? onTogglePick() : selectShot(selectedShotId === shot.id ? null : shot.id))}
      className={cn(
        "relative h-20 shrink-0 cursor-pointer touch-none overflow-hidden rounded-md border bg-surface-2",
        selectedShotId === shot.id && "border-foreground/60",
        picked && "ring-2 ring-port-image/70",
      )}
      style={{ width: Math.max(44, shot.durationSec * PX_PER_SEC) }}
      title={`${number} · ${shot.durationSec}s — ${shot.description.value || "Sans action"}`}
    >
      {asset &&
        (asset.kind === "video" ? (
          <video src={`${assetUrl(asset.id)}#t=0.1`} preload="metadata" muted className="absolute inset-0 size-full object-cover opacity-80" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(asset.id)} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
        ))}
      {!asset && <Clapperboard className="absolute right-1.5 bottom-1.5 size-3.5 text-muted-foreground/40" />}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-1.5 py-1 text-[10px] text-white">
        <span className="font-mono">{number}</span>
        <span className="font-mono text-white/70">{shot.durationSec}s</span>
        <ScaleIcon scale={camera.scale} className="size-3.5" />
        <MovementIcon movement={camera.movement} className="size-3.5" />
      </div>
      {!asset && <p className="absolute inset-x-1.5 top-6 line-clamp-2 text-[10px] leading-tight text-muted-foreground">{shot.description.value}</p>}
    </div>
  );
}

// --- board ----------------------------------------------------------------------------------

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

/** Storyboard (PRD §10): board and timeline, reorder, staged fill, selection, filters, animatic. */
export function Board() {
  const { project, currentProjectId, refresh } = useProjectStore();
  const ui = useUiStore();
  const modelsData = useModels();
  const [batch, setBatch] = useState<BatchRequest | null>(null);
  const [animatic, setAnimatic] = useState<number | null>(null);
  /** Optimistic order while a move is saved. */
  const [pendingOrder, setPendingOrder] = useState<Record<string, string[]> | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pending = inFlightCount(project);

  if (!currentProjectId) return <EmptyState />;
  if (!project) return <div className="grid flex-1 place-items-center text-xs text-muted-foreground">Chargement…</div>;

  const allShots = project.sequences.flatMap((s) => s.shots);
  const takes = allShots.reduce((n, s) => n + s.takes.length, 0);
  const onChanged = () => void refresh();
  const { keyframe, video } = defaultModels(modelsData?.models, project.settings);
  const videoCamera: CameraCapabilities | undefined = modelsData?.models.find((m) => m.id === video)?.camera;
  const inspectorOpen = allShots.some((s) => s.id === ui.selectedShotId);
  const filtering = !!(ui.filters.status || ui.filters.characterId || ui.filters.locationId);
  const characters = project.references.filter((r) => r.tag === "character");
  const locations = project.references.filter((r) => r.tag === "location");
  const timeline = ui.storyboardView === "timeline";
  const picked = ui.picked.filter((id) => allShots.some((s) => s.id === id));

  const ordered = (seq: SequenceTree) => {
    const ids = pendingOrder?.[seq.id];
    if (!ids) return seq.shots;
    const byId = new Map(allShots.map((s) => [s.id, s]));
    return ids.map((id) => byId.get(id)).filter((s): s is ShotWithTakes => !!s);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = project.sequences.find((s) => s.shots.some((sh) => sh.id === active.id));
    const overId = String(over.id);
    const to = overId.startsWith("seq:")
      ? project.sequences.find((s) => s.id === overId.slice(4))
      : project.sequences.find((s) => s.shots.some((sh) => sh.id === overId));
    if (!from || !to) return;
    const target = to.shots.map((s) => s.id).filter((id) => id !== active.id);
    const index = overId.startsWith("seq:") ? target.length : Math.max(0, to.shots.findIndex((s) => s.id === overId));
    target.splice(index, 0, String(active.id));
    setPendingOrder({
      ...(from.id !== to.id ? { [from.id]: from.shots.map((s) => s.id).filter((id) => id !== active.id) } : {}),
      [to.id]: target,
    });
    void api(`/api/shots/${active.id}/move`, { body: { sequenceId: to.id, index } })
      .then(() => refresh())
      .finally(() => setPendingOrder(null));
  };

  const shotNumber = new Map(project.sequences.flatMap((s, i) => s.shots.map((sh, j) => [sh.id, `${i + 1}.${j + 1}`] as const)));

  return (
    <>
      <div
        className={cn(
          "relative flex-1 overflow-y-auto pt-4 pb-48",
          ui.bibleOpen ? "pl-[304px]" : "pl-8 pt-14",
          inspectorOpen ? "pr-[372px]" : "pr-8",
        )}
      >
        {/* Toolbar: view, filters */}
        <div className="sticky top-0 z-20 mb-5 flex flex-wrap items-center gap-2 pb-1">
          <Island>
            <Pill active={!timeline} onClick={() => ui.setStoryboardView("board")}>
              <LayoutGrid /> Planche
            </Pill>
            <Pill active={timeline} onClick={() => ui.setStoryboardView("timeline")}>
              <Rows3 /> Timeline
            </Pill>
          </Island>
          <Island className="gap-1 px-2">
            <span className="px-1 text-[11px] text-muted-foreground">Filtrer</span>
            <select
              aria-label="Filtrer par statut"
              value={ui.filters.status ?? ""}
              onChange={(e) => ui.setFilters({ ...ui.filters, status: (e.target.value || undefined) as ShotStatus | undefined })}
              className="h-8 rounded-md bg-surface-2 px-2 text-[11px] outline-none"
            >
              <option value="">Tous les statuts</option>
              {(Object.keys(STATUS_LABEL) as ShotStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select
              aria-label="Filtrer par personnage"
              value={ui.filters.characterId ?? ""}
              onChange={(e) => ui.setFilters({ ...ui.filters, characterId: e.target.value || undefined })}
              className="h-8 rounded-md bg-surface-2 px-2 text-[11px] outline-none"
            >
              <option value="">Tous les personnages</option>
              {characters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              aria-label="Filtrer par lieu"
              value={ui.filters.locationId ?? ""}
              onChange={(e) => ui.setFilters({ ...ui.filters, locationId: e.target.value || undefined })}
              className="h-8 rounded-md bg-surface-2 px-2 text-[11px] outline-none"
            >
              <option value="">Tous les lieux</option>
              {locations.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {filtering && (
              <Pill className="h-8 text-[11px]" onClick={() => ui.setFilters({})}>
                <X /> Effacer
              </Pill>
            )}
          </Island>
          <span className="text-[10px] text-muted-foreground">
            {filtering ? "Filtre actif : le glisser-déposer est désactivé." : "Glisse la poignée pour réordonner · ⌘/Maj-clic pour sélectionner plusieurs plans"}
          </span>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {project.sequences.map((seq, i) => {
            const shots = ordered(seq);
            const visible = shots.filter((sh) => matches(sh, seq, ui.filters));
            return (
              <section key={seq.id} className="mb-10">
                <SequenceHeader
                  seq={seq}
                  index={i}
                  visible={visible}
                  onChanged={onChanged}
                  onBatch={setBatch}
                  onAnimatic={() => setAnimatic(i)}
                />
                <SortableContext items={visible.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
                  <SequenceDrop id={seq.id} className={cn("flex overflow-x-auto pb-2", timeline ? "gap-0.5" : "gap-2")}>
                    {visible.map((sh, j) => {
                      const number = shotNumber.get(sh.id) ?? `${i + 1}.${j + 1}`;
                      const isPicked = picked.includes(sh.id);
                      return (
                        <div key={sh.id} className="flex shrink-0">
                          {!filtering && !timeline && <InsertGap seqId={seq.id} index={shots.indexOf(sh)} onChanged={onChanged} tall />}
                          <SortableCard id={sh.id} disabled={filtering}>
                            {(handle) =>
                              timeline ? (
                                <TimelineBlock shot={sh} number={number} project={project} handle={handle} picked={isPicked} onTogglePick={() => ui.togglePicked(sh.id)} />
                              ) : (
                                <ShotCard
                                  shot={sh}
                                  number={number}
                                  assets={project.assets}
                                  onChanged={onChanged}
                                  videoCamera={videoCamera}
                                  defaultKeyframeModel={keyframe}
                                  defaultVideoModel={video}
                                  handle={handle}
                                  picked={isPicked}
                                  onTogglePick={() => ui.togglePicked(sh.id)}
                                />
                              )
                            }
                          </SortableCard>
                        </div>
                      );
                    })}
                    {!filtering && !timeline && seq.shots.length > 0 && <InsertGap seqId={seq.id} index={seq.shots.length} onChanged={onChanged} tall />}
                    {visible.length === 0 && (
                      <p className="py-6 text-xs text-muted-foreground">{seq.shots.length ? "Aucun plan ne correspond au filtre." : "Aucun plan : dépose-en un ici ou ajoute-le."}</p>
                    )}
                  </SequenceDrop>
                </SortableContext>
                {timeline && (
                  <div className="mt-1 flex font-mono text-[9px] text-muted-foreground/70">
                    {Array.from({ length: Math.ceil(seq.shots.reduce((n, s) => n + s.durationSec, 0) / 5) + 1 }, (_, k) => (
                      <span key={k} className="shrink-0" style={{ width: 5 * PX_PER_SEC }}>
                        {k * 5}s
                      </span>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </DndContext>

        <Pill onClick={() => void api(`/api/projects/${project.id}/sequences`, { body: {} }).then(onChanged)}>
          <Plus /> Séquence
        </Pill>
        <CornerStats
          side="left"
          items={[
            ["Coût", formatUsd(project.cost.actualUsd)],
            ["Estimé", formatUsd(project.cost.estimatedUsd)],
            ["Plans", String(allShots.length)],
            ["Prises", String(takes)],
            ["Jobs", String(pending)],
          ]}
        />
      </div>

      {/* Multiple selection → batch generation */}
      {picked.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
          <Island className="pointer-events-auto">
            <span className="px-2 text-xs">
              {picked.length} plan{picked.length > 1 ? "s" : ""} sélectionné{picked.length > 1 ? "s" : ""}
            </span>
            {(["sketch", "keyframe", "video"] as const).map((stage) => (
              <Pill key={stage} onClick={() => setBatch({ shotIds: picked, stage, title: "sélection" })}>
                {STAGE_ICON[stage]} {STAGE_LABEL[stage]}
              </Pill>
            ))}
            <Pill onClick={() => ui.setPicked([])}>
              <X /> Vider
            </Pill>
          </Island>
        </div>
      )}

      {inspectorOpen && <ShotInspector project={project} />}
      {batch && (
        <BatchDialog
          project={project}
          shotIds={batch.shotIds}
          stage={batch.stage}
          title={batch.title}
          onClose={() => setBatch(null)}
          onLaunched={() => {
            ui.setPicked([]);
            onChanged();
          }}
        />
      )}
      {animatic !== null && project.sequences[animatic] && (
        <Animatic project={project} sequence={project.sequences[animatic]} number={animatic + 1} onClose={() => setAnimatic(null)} />
      )}
    </>
  );
}
