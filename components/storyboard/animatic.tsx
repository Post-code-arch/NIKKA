"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { IconPill } from "@/components/ui/pill";
import type { Take } from "@/db/schema";
import type { ProjectTree, SequenceTree } from "@/lib/projects/queries";
import { assetUrl } from "@/lib/store/api";

/** The take a shot shows: the retained one, else the latest completed (video first). */
export function shownTake(shot: SequenceTree["shots"][number]): Take | undefined {
  const done = shot.takes.filter((t) => t.status === "completed" && t.assetId);
  const retained = done.find((t) => t.id === shot.selectedTakeId);
  // A retained keyframe that was animated plays as its video.
  const animated = retained && retained.stage !== "video" ? done.find((t) => t.stage === "video" && t.parentTakeId === retained.id) : undefined;
  return animated ?? retained ?? done.find((t) => t.stage === "video") ?? done[0];
}

/**
 * Minimal animatic (PRD §10): plays the retained takes of a sequence at the
 * shots' durations. A video plays; a still image gets a slow zoom; a shot
 * without image shows its action.
 */
export function Animatic({ project, sequence, number, onClose }: { project: ProjectTree; sequence: SequenceTree; number: number; onClose: () => void }) {
  const shots = sequence.shots;
  const total = shots.reduce((n, s) => n + s.durationSec, 0);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const shot = shots[index];
  const take = shot ? shownTake(shot) : undefined;
  const asset = take?.assetId ? project.assets[take.assetId] : undefined;
  const before = shots.slice(0, index).reduce((n, s) => n + s.durationSec, 0);

  useEffect(() => {
    if (!playing || !shot) return;
    const start = performance.now() - elapsed * 1000;
    const t = setInterval(() => {
      const e = (performance.now() - start) / 1000;
      if (e >= shot.durationSec) {
        if (index + 1 < shots.length) {
          setIndex(index + 1);
          setElapsed(0);
        } else {
          setElapsed(shot.durationSec);
          setPlaying(false);
        }
      } else setElapsed(e);
    }, 50);
    return () => clearInterval(t);
    // `elapsed` is read once when (re)starting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, shot]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play().catch(() => {});
    else v.pause();
  }, [playing, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (i: number) => {
    setIndex(Math.max(0, Math.min(shots.length - 1, i)));
    setElapsed(0);
    setPlaying(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6" role="dialog" aria-label="Animatique">
      <div className="mb-3 flex w-full max-w-5xl items-center justify-between text-xs text-white/80">
        <span>
          Animatique · Séquence {number} — {sequence.title.value}
        </span>
        <IconPill aria-label="Fermer" className="bg-white/10 text-white" onClick={onClose}>
          <X />
        </IconPill>
      </div>
      <div className="relative aspect-video w-full max-w-5xl overflow-hidden rounded-lg bg-black">
        {shot &&
          (asset?.kind === "video" ? (
            <video key={`${shot.id}-${asset.id}`} ref={video} src={assetUrl(asset.id)} muted playsInline autoPlay className="size-full object-cover" />
          ) : asset ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${shot.id}-${asset.id}`}
              src={assetUrl(asset.id)}
              alt=""
              className="size-full object-cover"
              style={{
                animation: `nikka-kenburns ${shot.durationSec}s linear forwards`,
                animationPlayState: playing ? "running" : "paused",
              }}
            />
          ) : (
            <div className="grid size-full place-items-center p-10 text-center text-lg text-white/70">{shot.description.value || "Plan sans action"}</div>
          ))}
        <div className="absolute top-3 left-3 rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">
          {number}.{index + 1} · {shot?.durationSec}s
        </div>
        {shot?.dialogue?.value && (
          <div className="absolute inset-x-0 bottom-6 text-center text-base text-white drop-shadow-[0_1px_2px_black]">« {shot.dialogue.value} »</div>
        )}
      </div>
      <div className="mt-3 flex w-full max-w-5xl items-center gap-3 text-white">
        <IconPill aria-label="Plan précédent" className="bg-white/10 text-white" onClick={() => go(index - 1)}>
          <SkipBack />
        </IconPill>
        <IconPill aria-label={playing ? "Pause" : "Lecture"} className="bg-white/10 text-white" onClick={() => (index === shots.length - 1 && !playing && elapsed >= (shot?.durationSec ?? 0) ? go(0) : setPlaying((p) => !p))}>
          {playing ? <Pause /> : <Play />}
        </IconPill>
        <IconPill aria-label="Plan suivant" className="bg-white/10 text-white" onClick={() => go(index + 1)}>
          <SkipForward />
        </IconPill>
        {/* Timeline of the sequence: one segment per shot, at its duration. */}
        <div className="flex h-2 flex-1 gap-0.5">
          {shots.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Aller au plan ${number}.${i + 1}`}
              onClick={() => go(i)}
              className="relative h-full overflow-hidden rounded-sm bg-white/20"
              style={{ flex: s.durationSec }}
            >
              <span
                className="absolute inset-y-0 left-0 bg-white"
                style={{ width: i < index ? "100%" : i === index ? `${Math.min(100, (elapsed / s.durationSec) * 100)}%` : "0%" }}
              />
            </button>
          ))}
        </div>
        <span className="w-24 text-right font-mono text-xs text-white/70">
          {(before + elapsed).toFixed(1)} / {total.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
