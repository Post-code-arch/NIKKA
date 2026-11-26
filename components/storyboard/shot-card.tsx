"use client";

import { useState } from "react";
import { AlertCircle, Check, Clapperboard, Film, GripVertical, Image as ImageIcon, Loader2, Pencil, Scissors, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconPill } from "@/components/ui/pill";
import type { ShotStatus, Take } from "@/db/schema";
import { formatUsd } from "@/lib/cost/estimate";
import type { ProjectTree, ShotWithTakes } from "@/lib/projects/queries";
import { api, assetUrl } from "@/lib/store/api";
import { MovementIcon, ScaleIcon } from "@/components/camera/icons";
import { MOVEMENT_LABEL, SCALE_LABEL } from "@/lib/camera/labels";
import { supportsMovement, type CameraCapabilities } from "@/lib/camera/phrasing";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { GenerateDialog } from "./generate-dialog";
import { MovementOverlay } from "./movement-overlay";

export const STATUS_LABEL: Record<ShotStatus, string> = {
  to_write: "À écrire",
  to_generate: "À générer",
  generating: "En génération",
  to_review: "À valider",
  approved: "Validé",
};

const TAKE_LABEL: Record<Take["status"], string> = {
  queued: "En file",
  processing: "En cours",
  completed: "Terminée",
  failed: "Échec",
};

function TakeMedia({ take, assets, className }: { take: Take; assets: ProjectTree["assets"]; className?: string }) {
  const asset = take.assetId ? assets[take.assetId] : undefined;
  if (take.status === "queued" || take.status === "processing") {
    return (
      <div className={cn("grid place-items-center bg-surface-2 text-[11px] text-muted-foreground", className)}>
        <span className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" /> {TAKE_LABEL[take.status]}
        </span>
      </div>
    );
  }
  if (take.status === "failed" || !asset) {
    return (
      <div className={cn("grid place-items-center bg-surface-2 p-2 text-center text-[10px] text-destructive", className)}>
        <span className="flex items-center gap-1"><AlertCircle className="size-3.5" /> Échec</span>
      </div>
    );
  }
  return asset.kind === "video" ? (
    <video src={`${assetUrl(asset.id)}#t=0.1`} preload="metadata" className={cn("object-cover", className)} muted loop playsInline
      onMouseEnter={(e) => void e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={assetUrl(asset.id)} alt="" className={cn("object-cover", className)} />
  );
}

export function ShotCard({
  shot,
  number,
  assets,
  onChanged,
  videoCamera,
  defaultKeyframeModel,
  defaultVideoModel,
  handle,
  picked,
  onTogglePick,
}: {
  shot: ShotWithTakes;
  number: string;
  assets: ProjectTree["assets"];
  onChanged: () => void;
  /** Camera capabilities of the project's video model, for the warning badge. */
  videoCamera?: CameraCapabilities;
  defaultKeyframeModel?: string | null;
  defaultVideoModel?: string | null;
  /** Drag handle props (dnd-kit listeners and attributes). */
  handle?: React.HTMLAttributes<HTMLElement>;
  picked?: boolean;
  onTogglePick?: () => void;
}) {
  const selectedShotId = useUiStore((s) => s.selectedShotId);
  const selectShot = useUiStore((s) => s.selectShot);
  const isSelected = selectedShotId === shot.id;
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  const unsupported = !supportsMovement(videoCamera, camera.movement);
  const [description, setDescription] = useState(shot.description.value);
  const [dialog, setDialog] = useState<null | "keyframe" | "video">(null);
  const [expanded, setExpanded] = useState(false);

  const selected =
    shot.takes.find((t) => t.id === shot.selectedTakeId) ??
    shot.takes.find((t) => t.status !== "failed") ??
    shot.takes[0];
  const keyframeForVideo = selected?.status === "completed" && selected.assetId && assets[selected.assetId]?.kind === "image"
    ? selected
    : undefined;
  const estimated = shot.takes.reduce((n, t) => n + t.costEstimatedUsd, 0);
  const actual = shot.takes.reduce((n, t) => n + (t.costActualUsd ?? 0), 0);
  const notes = [shot.dialogue?.value && `« ${shot.dialogue.value} »`, shot.sound?.value && `Son : ${shot.sound.value}`].filter(Boolean).join(" · ");

  const save = async (patch: Record<string, unknown>) => {
    await api(`/api/shots/${shot.id}`, { method: "PATCH", body: patch });
    onChanged();
  };

  return (
    <div className="w-64 shrink-0">
      <div className="mb-2 flex h-6 items-center justify-between px-1 text-[11px]">
        <span className="flex items-center gap-2">
          {handle && (
            <span {...handle} className="-ml-1 cursor-grab touch-none text-muted-foreground/60 hover:text-foreground active:cursor-grabbing" aria-label="Déplacer le plan" title="Glisser pour réordonner">
              <GripVertical className="size-3.5" />
            </span>
          )}
          {onTogglePick && (
            <button
              type="button"
              aria-label={picked ? "Retirer de la sélection" : "Ajouter à la sélection"}
              onClick={onTogglePick}
              className={cn("grid size-3.5 place-items-center rounded-[4px] border", picked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40")}
            >
              {picked && <Check className="size-2.5" />}
            </button>
          )}
          <span className="font-mono text-foreground">{number}</span>
          <span className="font-mono text-muted-foreground">{shot.durationSec}s</span>
          <span className="flex items-center gap-0.5 text-muted-foreground" title={`${SCALE_LABEL[camera.scale]} · ${MOVEMENT_LABEL[camera.movement]}`}>
            <ScaleIcon scale={camera.scale} className="size-4" />
            <MovementIcon movement={camera.movement} className={cn("size-4", unsupported && "text-origin-proposed")} />
            {unsupported && <AlertCircle className="size-3 text-origin-proposed" />}
          </span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {shot.description.origin !== "validated" && shot.description.value && (
            <span className="rounded-full bg-origin-proposed/15 px-1.5 text-[9px] text-origin-proposed uppercase" title="Plan encore proposé : à valider dans le Brief ou en le modifiant">
              {shot.description.origin === "proposed" ? "proposé" : "extrait"}
            </span>
          )}
          {STATUS_LABEL[shot.status]}
        </span>
      </div>
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button,textarea,video")) return;
          if ((e.metaKey || e.ctrlKey || e.shiftKey) && onTogglePick) onTogglePick();
          else selectShot(isSelected ? null : shot.id);
        }}
        className={cn(
          "cursor-pointer rounded-[14px] border bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]",
          isSelected && "border-foreground/50",
          picked && "ring-2 ring-port-image/70",
        )}
      >
        <div className="relative aspect-video overflow-hidden rounded-[10px] bg-surface-2">
          {selected ? (
            <TakeMedia take={selected} assets={assets} className="size-full" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground/50">
              <Clapperboard className="size-6" />
            </div>
          )}
          {camera.movement !== "static" && (
            <MovementOverlay movement={camera.movement} className="pointer-events-none absolute inset-0 size-full opacity-80" />
          )}
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== shot.description.value && void save({ description: { value: description, origin: "validated" } })}
          rows={2}
          placeholder="Action du plan…"
          className="mt-1.5 w-full resize-none rounded-md bg-transparent px-1.5 py-1 text-[11px] leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:bg-surface-2"
        />
        {notes && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            title={expanded ? "Replier" : "Déplier"}
            className={cn("mb-1 block w-full px-1.5 text-left text-[10px] text-muted-foreground", !expanded && "truncate")}
          >
            {notes}
          </button>
        )}

        <div className="flex items-center gap-1 px-0.5 pb-0.5">
          <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => setDialog("keyframe")} disabled={!description.trim()}>
            <Sparkles /> Image clé
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-[11px]" disabled={!keyframeForVideo} onClick={() => setDialog("video")}
            title={keyframeForVideo ? "Animer la prise retenue" : "Il faut d'abord une image clé terminée"}>
            <Film /> Animer
          </Button>
          <IconPill aria-label="Couper le plan en deux" title="Couper en deux" className="size-7 bg-transparent"
            onClick={() => void api(`/api/shots/${shot.id}/split`, { body: {} }).then(onChanged)}>
            <Scissors />
          </IconPill>
          <IconPill aria-label="Supprimer le plan" className="size-7 bg-transparent"
            onClick={() => confirm("Supprimer ce plan et ses prises ?") && void api(`/api/shots/${shot.id}`, { method: "DELETE" }).then(onChanged)}>
            <Trash2 />
          </IconPill>
        </div>
      </div>

      {shot.takes.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto px-0.5 pb-1">
          {shot.takes.map((t, i) => (
            <button
              key={t.id}
              type="button"
              title={`Prise ${shot.takes.length - i} · ${t.stage} · ${TAKE_LABEL[t.status]}${t.error ? ` — ${t.error}` : ""}`}
              onClick={() => t.status === "completed" && void save({ selectedTakeId: t.id })}
              className={cn(
                "relative h-9 w-14 shrink-0 overflow-hidden rounded-md border-2 border-transparent",
                selected?.id === t.id && "border-foreground/80",
              )}
            >
              <TakeMedia take={t} assets={assets} className="size-full text-[0px]" />
              {t.stage === "video" && <Film className="absolute right-0.5 bottom-0.5 size-2.5 text-white drop-shadow" />}
              {t.stage === "keyframe" && t.status === "completed" && <ImageIcon className="absolute right-0.5 bottom-0.5 size-2.5 text-white drop-shadow" />}
              {t.stage === "sketch" && t.status === "completed" && <Pencil className="absolute right-0.5 bottom-0.5 size-2.5 text-white drop-shadow" />}
            </button>
          ))}
          <span className="ml-auto shrink-0 pl-1 text-right font-mono text-[10px] leading-tight text-muted-foreground" title="Coût estimé / coût réel">
            {formatUsd(estimated)}
            <br />
            <span className="text-foreground/80">{formatUsd(actual)}</span>
          </span>
        </div>
      )}

      {dialog && (
        <GenerateDialog shot={shot} mode={dialog} parentTake={dialog === "video" ? keyframeForVideo : undefined}
          defaultModelId={dialog === "video" ? defaultVideoModel : defaultKeyframeModel}
          onClose={() => setDialog(null)} onLaunched={onChanged} />
      )}
    </div>
  );
}
