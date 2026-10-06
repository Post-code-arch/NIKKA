"use client";

import { useState } from "react";
import { AlertCircle, Clapperboard, Film, Image as ImageIcon, Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconPill } from "@/components/ui/pill";
import type { ShotStatus, Take } from "@/db/schema";
import { formatUsd } from "@/lib/cost/estimate";
import type { ProjectTree, ShotWithTakes } from "@/lib/projects/queries";
import { api, assetUrl } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { GenerateDialog } from "./generate-dialog";

const STATUS_LABEL: Record<ShotStatus, string> = {
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
}: {
  shot: ShotWithTakes;
  number: string;
  assets: ProjectTree["assets"];
  onChanged: () => void;
}) {
  const [description, setDescription] = useState(shot.description.value);
  const [dialog, setDialog] = useState<null | "keyframe" | "video">(null);

  const selected =
    shot.takes.find((t) => t.id === shot.selectedTakeId) ??
    shot.takes.find((t) => t.status !== "failed") ??
    shot.takes[0];
  const keyframeForVideo = selected?.status === "completed" && selected.assetId && assets[selected.assetId]?.kind === "image"
    ? selected
    : undefined;
  const cost = shot.takes.reduce((n, t) => n + (t.costActualUsd ?? t.costEstimatedUsd), 0);

  const save = async (patch: Record<string, unknown>) => {
    await api(`/api/shots/${shot.id}`, { method: "PATCH", body: patch });
    onChanged();
  };

  return (
    <div className="w-64 shrink-0">
      <div className="mb-2 flex h-6 items-center justify-between px-1 text-[11px]">
        <span className="flex items-center gap-2">
          <span className="font-mono text-foreground">{number}</span>
          <span className="font-mono text-muted-foreground">{shot.durationSec}s</span>
        </span>
        <span className="text-muted-foreground">{STATUS_LABEL[shot.status]}</span>
      </div>
      <div className="rounded-[14px] border bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
        <div className="relative aspect-video overflow-hidden rounded-[10px] bg-surface-2">
          {selected ? (
            <TakeMedia take={selected} assets={assets} className="size-full" />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground/50">
              <Clapperboard className="size-6" />
            </div>
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

        <div className="flex items-center gap-1 px-0.5 pb-0.5">
          <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => setDialog("keyframe")} disabled={!description.trim()}>
            <Sparkles /> Image clé
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-[11px]" disabled={!keyframeForVideo} onClick={() => setDialog("video")}
            title={keyframeForVideo ? "Animer la prise retenue" : "Il faut d'abord une image clé terminée"}>
            <Film /> Animer
          </Button>
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
              {t.stage !== "video" && t.status === "completed" && <ImageIcon className="absolute right-0.5 bottom-0.5 size-2.5 text-white drop-shadow" />}
            </button>
          ))}
          <span className="ml-auto pl-1 font-mono text-[10px] text-muted-foreground">{formatUsd(cost)}</span>
        </div>
      )}

      {dialog && (
        <GenerateDialog shot={shot} mode={dialog} parentTake={dialog === "video" ? keyframeForVideo : undefined}
          initialPrompt={dialog === "keyframe" ? description : undefined}
          onClose={() => setDialog(null)} onLaunched={onChanged} />
      )}
    </div>
  );
}
