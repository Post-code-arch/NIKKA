"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { AngleIcon, MovementIcon, ScaleIcon } from "@/components/camera/icons";
import { Thumb } from "@/components/bible/view-thumb";
import { IconPill, Pill } from "@/components/ui/pill";
import {
  ANGLE_LABEL,
  ANGLE_ORDER,
  DOF_LABEL,
  LENS_LABEL,
  MOVEMENT_LABEL,
  MOVEMENT_ORDER,
  SCALE_LABEL,
  SCALE_ORDER,
  SPEED_LABEL,
} from "@/lib/camera/labels";
import { supportsMovement } from "@/lib/camera/phrasing";
import { DEFAULT_CAMERA, type CameraAttrs } from "@/lib/camera/types";
import type { ShotPromptPreview } from "@/lib/prompt/shot";
import type { ProjectTree } from "@/lib/projects/queries";
import { TAG_COLOR_VAR, VIEW_LABEL } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { defaultModels, useModels } from "@/lib/store/models";
import { useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

const PART_COLOR: Record<string, string> = {
  descriptor: "var(--tag-character)",
  action: "var(--foreground)",
  camera: "var(--port-image)",
  look: "var(--tag-look)",
};

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] text-muted-foreground">{title}</h3>
        {aside && <span className="text-[11px] text-foreground/80">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Tile({
  active,
  warn,
  title,
  onClick,
  children,
  className,
}: {
  active: boolean;
  warn?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-md bg-surface-2 p-1.5 text-[9px] leading-tight text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground",
        active && "bg-foreground text-background hover:bg-foreground hover:text-background",
        className,
      )}
    >
      {children}
      {warn && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-origin-proposed" />}
    </button>
  );
}

/** Right panel: the selected shot's sheet (camera, references, models, prompt preview). */
export function ShotInspector({ project }: { project: ProjectTree }) {
  const selectedShotId = useUiStore((s) => s.selectedShotId);
  const selectShot = useUiStore((s) => s.selectShot);
  const refresh = useProjectStore((s) => s.refresh);
  const modelsData = useModels();
  const [preview, setPreview] = useState<ShotPromptPreview | null>(null);

  const located = project.sequences
    .flatMap((seq, i) => seq.shots.map((sh, j) => ({ sh, number: `${i + 1}.${j + 1}` })))
    .find((x) => x.sh.id === selectedShotId);
  const shot = located?.sh;
  const camera: CameraAttrs = shot?.camera?.value ?? DEFAULT_CAMERA;
  const { keyframeChoices, videoChoices, keyframe, video } = defaultModels(modelsData?.models, project.settings);
  const videoModel = modelsData?.models.find((m) => m.id === video);

  const previewKey = shot ? JSON.stringify([shot.id, shot.camera, shot.refIds, shot.description.value, keyframe, video, project.references.map((r) => r.descriptor + r.variants.map((v) => v.views.length).join())]) : "";
  useEffect(() => {
    if (!shot) return;
    const q = new URLSearchParams();
    if (keyframe) q.set("keyframe", keyframe);
    if (video) q.set("video", video);
    void api<ShotPromptPreview>(`/api/shots/${shot.id}/prompt?${q}`).then(setPreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  if (!shot) return null;

  const setCamera = async (patch: Partial<CameraAttrs>) => {
    const next: CameraAttrs = { ...camera, ...patch };
    // Remove optional fields set to undefined.
    for (const k of Object.keys(next) as (keyof CameraAttrs)[]) if (next[k] === undefined) delete next[k];
    await api(`/api/shots/${shot.id}`, { method: "PATCH", body: { camera: { value: next, origin: "validated" } } });
    await refresh();
  };
  const setRefIds = async (refIds: string[]) => {
    await api(`/api/shots/${shot.id}`, { method: "PATCH", body: { refIds } });
    await refresh();
  };
  const setDefaultModel = async (role: "keyframe" | "video", id: string) => {
    await api(`/api/projects/${project.id}`, {
      method: "PATCH",
      body: { settings: { defaultModels: { ...project.settings.defaultModels, [role]: id } } },
    });
    await refresh();
  };

  const bible = project.references.filter((r) => r.scope === "bible");

  return (
    <aside className="island pointer-events-auto absolute top-3 right-4 bottom-4 z-20 flex w-[340px] flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs">
          Plan <span className="font-mono">{located?.number}</span>
          <span className="ml-2 font-mono text-muted-foreground">{shot.durationSec}s</span>
        </span>
        <IconPill aria-label="Fermer la fiche" className="size-7 bg-transparent" onClick={() => selectShot(null)}>
          <X />
        </IconPill>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
        <Section title="Échelle" aside={SCALE_LABEL[camera.scale]}>
          <div className="grid grid-cols-3 gap-1">
            {SCALE_ORDER.map((s) => (
              <Tile key={s} active={camera.scale === s} title={SCALE_LABEL[s]} onClick={() => void setCamera({ scale: s })}>
                <ScaleIcon scale={s} className="size-6" />
                {SCALE_LABEL[s]}
              </Tile>
            ))}
          </div>
        </Section>

        <Section title="Angle" aside={ANGLE_LABEL[camera.angle]}>
          <div className="grid grid-cols-5 gap-1">
            {ANGLE_ORDER.map((a) => (
              <Tile key={a} active={camera.angle === a} title={ANGLE_LABEL[a]} onClick={() => void setCamera({ angle: a })}>
                <AngleIcon angle={a} className="size-6" />
              </Tile>
            ))}
          </div>
        </Section>

        <Section title="Mouvement" aside={MOVEMENT_LABEL[camera.movement]}>
          <div className="grid grid-cols-6 gap-1">
            {MOVEMENT_ORDER.map((m) => (
              <Tile
                key={m}
                active={camera.movement === m}
                warn={!supportsMovement(videoModel?.camera, m)}
                title={MOVEMENT_LABEL[m] + (supportsMovement(videoModel?.camera, m) ? "" : " — non supporté par le modèle vidéo")}
                onClick={() => void setCamera({ movement: m })}
                className="aspect-square"
              >
                <MovementIcon movement={m} className="size-5" />
              </Tile>
            ))}
          </div>
          {preview && !preview.movement.supported && (
            <div className="mt-2 rounded-md border border-origin-proposed/40 bg-origin-proposed/10 p-2 text-[11px] leading-relaxed">
              <AlertTriangle className="mr-1 inline size-3.5 text-origin-proposed" />
              {videoModel?.label ?? "Le modèle vidéo"} ne sait pas faire « {MOVEMENT_LABEL[camera.movement]} ».
              {preview.movement.alternatives.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {preview.movement.alternatives.map((a) => (
                    <Pill key={a.id} className="h-7 text-[11px]" onClick={() => void setDefaultModel("video", a.id)}>
                      Utiliser {a.label}
                    </Pill>
                  ))}
                </div>
              ) : (
                <span> Aucun modèle disponible ne le gère : choisis un autre mouvement.</span>
              )}
            </div>
          )}
        </Section>

        <div className="mb-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[11px]">
          <span className="text-muted-foreground">Vitesse</span>
          <div className="flex gap-1">
            {(Object.keys(SPEED_LABEL) as NonNullable<CameraAttrs["speed"]>[]).map((v) => (
              <Pill
                key={v}
                className="h-7 px-2 text-[11px]"
                active={camera.speed === v}
                disabled={camera.movement === "static"}
                onClick={() => void setCamera({ speed: camera.speed === v ? undefined : v })}
              >
                {SPEED_LABEL[v]}
              </Pill>
            ))}
          </div>
          <span className="text-muted-foreground">Optique</span>
          <div className="flex flex-wrap gap-1">
            {([24, 35, 50, 85, 135] as const).map((v) => (
              <Pill
                key={v}
                className="h-7 px-2 font-mono text-[11px]"
                active={camera.lens === v}
                onClick={() => void setCamera({ lens: camera.lens === v ? undefined : v })}
              >
                {LENS_LABEL[v].replace(" mm", "")}
              </Pill>
            ))}
          </div>
          <span className="text-muted-foreground">Profondeur</span>
          <div className="flex gap-1">
            {(Object.keys(DOF_LABEL) as NonNullable<CameraAttrs["depthOfField"]>[]).map((v) => (
              <Pill
                key={v}
                className="h-7 px-2 text-[11px]"
                active={camera.depthOfField === v}
                onClick={() => void setCamera({ depthOfField: camera.depthOfField === v ? undefined : v })}
              >
                {DOF_LABEL[v]}
              </Pill>
            ))}
          </div>
        </div>

        <Section title="Références branchées">
          {bible.length === 0 && <p className="text-[11px] text-muted-foreground">Aucune référence dans la bible.</p>}
          <div className="flex flex-wrap gap-1">
            {bible.map((r) => {
              const on = shot.refIds.includes(r.id);
              return (
                <Pill
                  key={r.id}
                  className="h-7 text-[11px]"
                  active={on}
                  onClick={() => void setRefIds(on ? shot.refIds.filter((x) => x !== r.id) : [...shot.refIds, r.id])}
                >
                  {on ? <Check /> : <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[r.tag] }} />}
                  {r.name}
                </Pill>
              );
            })}
          </div>
        </Section>

        <Section title="Modèles">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[11px]">
            <span className="text-muted-foreground">Image clé</span>
            <select
              value={keyframe ?? ""}
              onChange={(e) => void setDefaultModel("keyframe", e.target.value)}
              className="h-7 min-w-0 rounded-md bg-surface-2 px-1.5 outline-none"
            >
              {keyframeChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">Vidéo</span>
            <select
              value={video ?? ""}
              onChange={(e) => void setDefaultModel("video", e.target.value)}
              className="h-7 min-w-0 rounded-md bg-surface-2 px-1.5 outline-none"
            >
              {videoChoices.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </Section>

        {preview?.references && (
          <Section title={`Vues envoyées · ${preview.references.picked.length}/${preview.references.maxSlots}`}>
            <div className="flex flex-wrap gap-1.5">
              {preview.references.picked.map((p, i) => (
                <div key={`${p.assetId}-${i}`} title={`${p.refName} · ${VIEW_LABEL[p.view]} — ${p.reason}`} className="w-14">
                  <Thumb assetId={p.assetId} className="size-14" />
                  <div className="truncate text-[9px] text-muted-foreground">{VIEW_LABEL[p.view]}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {preview && (
          <Section title="Prompt final">
            {(["keyframe", "video"] as const).map((stage) => (
              <div key={stage} className="mb-2 rounded-md bg-surface-2 p-2">
                <div className="mb-1 text-[10px] text-muted-foreground">{stage === "keyframe" ? "Image clé" : "Animation"}</div>
                <p className="text-[11px] leading-relaxed" data-testid={`prompt-${stage}`}>
                  {preview[stage].parts.map((p, i) => (
                    <span key={i} title={p.source} style={{ color: PART_COLOR[p.kind] }} className={p.kind === "action" ? "" : "opacity-90"}>
                      {p.text}
                      {i < preview[stage].parts.length - 1 ? " · " : ""}
                    </span>
                  ))}
                  {preview[stage].parts.length === 0 && <span className="text-muted-foreground">Écris l&apos;action du plan.</span>}
                </p>
              </div>
            ))}
            <p className="mb-3 text-[10px] text-muted-foreground">
              <span style={{ color: PART_COLOR.descriptor }}>descripteurs</span> ·{" "}
              <span>action</span> · <span style={{ color: PART_COLOR.camera }}>caméra</span> ·{" "}
              <span style={{ color: PART_COLOR.look }}>look</span>
            </p>
          </Section>
        )}
      </div>
    </aside>
  );
}
