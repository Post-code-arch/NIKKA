"use client";

import { useEffect, useState } from "react";
import { FlaskConical, X } from "lucide-react";
import { IconPill } from "@/components/ui/pill";
import type { Reference, ReferenceVariant } from "@/db/schema";
import { ANGLE_LABEL, SCALE_LABEL } from "@/lib/camera/labels";
import type { CameraAttrs } from "@/lib/camera/types";
import type { Selection } from "@/lib/refs/select";
import { TAG_COLOR_VAR, VIEW_LABEL } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { Modal } from "./reference-detail";
import { Thumb } from "./view-thumb";

type Scale = CameraAttrs["scale"];
type Angle = CameraAttrs["angle"];
type Ref = Reference & { variants: ReferenceVariant[] };

function Column({
  scale,
  onScale,
  result,
}: {
  scale: Scale;
  onScale: (s: Scale) => void;
  result: Selection | null;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-[12px] bg-surface-2 p-3">
      <select
        value={scale}
        onChange={(e) => onScale(e.target.value as Scale)}
        className="mb-3 h-8 w-full rounded-md bg-surface px-2 text-xs outline-none"
      >
        {(Object.keys(SCALE_LABEL) as Scale[]).map((s) => (
          <option key={s} value={s}>
            {SCALE_LABEL[s]}
          </option>
        ))}
      </select>
      {!result && <p className="text-[11px] text-muted-foreground">…</p>}
      {result && result.picked.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Aucune vue retenue : ajoute des images étiquetées aux références.</p>
      )}
      <div className="space-y-1.5">
        {result?.picked.map((p, i) => (
          <div key={`${p.assetId}-${i}`} className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{i + 1}</span>
            <Thumb assetId={p.assetId} className="size-11 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: TAG_COLOR_VAR[p.tag] }} />
                <span className="truncate">{p.refName}</span>
                <span className="text-muted-foreground">· {VIEW_LABEL[p.view]}</span>
              </div>
              <div className="truncate text-[10px] text-muted-foreground">{p.reason}</div>
            </div>
          </div>
        ))}
      </div>
      {result && result.dropped.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1 text-[10px] text-muted-foreground">Écartées</div>
          {result.dropped.map((d, i) => (
            <div key={`${d.assetId}-${i}`} className="truncate text-[10px] text-muted-foreground/80">
              {d.refName} · {VIEW_LABEL[d.view]} — {d.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Shows which reference views would be sent for two shot scales side by
 * side, with the same references, angle and slot budget (PRD §7).
 */
export function SelectionTester({ refs, onClose }: { refs: Ref[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(refs.map((r) => [r.id, r.variants[0]?.id ?? null])),
  );
  const [angle, setAngle] = useState<Angle>("eye_level");
  const [slots, setSlots] = useState(4);
  const [scales, setScales] = useState<[Scale, Scale]>(["close", "wide"]);
  const [results, setResults] = useState<[Selection | null, Selection | null]>([null, null]);

  const active = refs.filter((r) => chosen[r.id] !== undefined && chosen[r.id] !== null);
  const body = (scale: Scale) => ({
    refs: active.map((r) => ({ referenceId: r.id, variantId: chosen[r.id] ?? undefined })),
    scale,
    angle,
    maxSlots: slots,
  });
  const key = JSON.stringify([chosen, angle, slots, scales]);

  useEffect(() => {
    void Promise.all(scales.map((s) => api<Selection>("/api/refs/select", { body: body(s) }))).then((r) =>
      setResults([r[0], r[1]]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <Modal onClose={onClose} wide>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <FlaskConical className="size-4" /> Tester la sélection des vues
        </h2>
        <IconPill aria-label="Fermer" className="bg-transparent" onClick={onClose}>
          <X />
        </IconPill>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {refs.map((r) => {
          const on = chosen[r.id] !== null;
          return (
            <div key={r.id} className={cn("flex items-center gap-1 rounded-md bg-surface-2 py-1 pr-1 pl-2 text-[11px]", !on && "opacity-50")}>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setChosen((c) => ({ ...c, [r.id]: e.target.checked ? (r.variants[0]?.id ?? null) : null }))}
                />
                <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[r.tag] }} />
                {r.name}
              </label>
              {r.variants.length > 1 && on && (
                <select
                  value={chosen[r.id] ?? ""}
                  onChange={(e) => setChosen((c) => ({ ...c, [r.id]: e.target.value }))}
                  className="h-6 rounded bg-surface px-1 text-[10px] outline-none"
                >
                  {r.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1.5">
          Angle
          <select
            value={angle}
            onChange={(e) => setAngle(e.target.value as Angle)}
            className="h-7 rounded-md bg-surface-2 px-1.5 text-foreground outline-none"
          >
            {(Object.keys(ANGLE_LABEL) as Angle[]).map((a) => (
              <option key={a} value={a}>
                {ANGLE_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Images max envoyées au modèle
          <input
            type="number"
            min={1}
            max={14}
            value={slots}
            onChange={(e) => setSlots(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
            className="h-7 w-14 rounded-md bg-surface-2 px-1.5 font-mono text-foreground outline-none"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Column scale={scales[0]} onScale={(s) => setScales([s, scales[1]])} result={results[0]} />
        <Column scale={scales[1]} onScale={(s) => setScales([scales[0], s])} result={results[1]} />
      </div>
    </Modal>
  );
}
