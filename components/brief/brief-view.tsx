"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, Check, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ANGLE_LABEL, MOVEMENT_LABEL, SCALE_LABEL } from "@/lib/camera/labels";
import { formatUsd } from "@/lib/cost/estimate";
import type { Origin } from "@/lib/domain/field";
import {
  LEVEL_NAME,
  type DigestState,
  type Level,
  type StoredBreakdown,
  type StoredConcept,
  type StoredTreatment,
} from "@/lib/digester/schemas";
import type { DigestView } from "@/lib/digester/service";
import { TAG_COLOR_VAR, TAG_LABEL } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { useProjectStore } from "@/lib/store/project-store";
import { cn } from "@/lib/utils";

const ORIGIN_LABEL: Record<Origin, string> = { extracted: "extrait", proposed: "proposé", validated: "validé" };
const ORIGIN_COLOR: Record<Origin, string> = {
  extracted: "var(--origin-extracted)",
  proposed: "var(--origin-proposed)",
  validated: "var(--origin-validated)",
};

function OriginBadge({ origin, className }: { origin: Origin; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9px] tracking-wide uppercase", className)}
      style={{ color: ORIGIN_COLOR[origin], background: `color-mix(in oklab, ${ORIGIN_COLOR[origin]} 14%, transparent)` }}
    >
      <span className="size-1 rounded-full" style={{ background: ORIGIN_COLOR[origin] }} />
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

/** Text edited in place; committed on blur when it changed. */
function EditText({
  value,
  onCommit,
  rows = 2,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (base !== value) {
    setBase(value);
    setDraft(value);
  }
  return (
    <textarea
      value={draft}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={cn(
        "w-full resize-y rounded-md bg-surface px-2 py-1.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring",
        className,
      )}
    />
  );
}

function Select<T extends string>({ value, options, onChange, className }: { value: T; options: Record<T, string>; onChange: (v: T) => void; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={cn("h-7 rounded-md bg-surface px-1.5 text-[11px] outline-none", className)}>
      {(Object.keys(options) as T[]).map((k) => (
        <option key={k} value={k}>
          {options[k]}
        </option>
      ))}
    </select>
  );
}

function levelOrigin(state: DigestState, level: Level): Origin | null {
  if (state.validatedLevel >= level) return "validated";
  const origins: Origin[] =
    level === 1 ? (state.idea ? [state.idea.origin] : [])
    : level === 2 ? (state.concept ? Object.values(state.concept).map((f) => f.origin) : [])
    : level === 3 ? (state.treatment ? [state.treatment.artDirection.origin, ...state.treatment.entities.map((e) => e.origin), ...state.treatment.sequences.map((s) => s.origin)] : [])
    : state.breakdown ? state.breakdown.sequences.flatMap((s) => s.shots.map((sh) => sh.origin)) : [];
  if (origins.length === 0) return null;
  return origins.includes("proposed") ? "proposed" : origins.every((o) => o === "validated") ? "validated" : "extracted";
}

// --- view ------------------------------------------------------------------------------

export function BriefView() {
  const project = useProjectStore((s) => s.project);
  if (!project) {
    return <div className="grid flex-1 place-items-center text-xs text-muted-foreground">Ouvre ou crée un projet (menu du haut).</div>;
  }
  return <Digester key={project.id} projectId={project.id} />;
}

function Digester({ projectId }: { projectId: string }) {
  const refresh = useProjectStore((s) => s.refresh);
  const [view, setView] = useState<DigestView | null>(null);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/projects/${projectId}/digest`;

  useEffect(() => {
    void api<DigestView>(url).then((v) => {
      setView(v);
      setBrief(v.briefRaw);
    });
  }, [url]);

  const act = useCallback(
    async (label: string, path: string, body: unknown, method: "POST" | "PUT" = "POST") => {
      setBusy(label);
      setError(null);
      try {
        const v = await api<DigestView>(path, { method, body });
        setView(v);
        if (label.startsWith("validate")) await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  if (!view) return <div className="grid flex-1 place-items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>;
  const { state } = view;
  const cost = view.llm.mock ? "gratuit (mock)" : `≈ ${formatUsd(view.llm.estimatedUsdPerCall)} par appel LLM`;
  const propose = (level: Level) => act(`propose-${level}`, `${url}/propose`, { level });
  const validate = (level: Level) => act(`validate-${level}`, `${url}/validate`, { level });
  const update = (level: Level, data: unknown) => act(`update-${level}`, url, { level, data }, "PUT");

  const panel = (level: Level, body: React.ReactNode, present: boolean) => {
    const origin = levelOrigin(state, level);
    const deepest = state.validatedLevel === level && level < 4;
    return (
      <section key={level} className="island p-4" data-level={level}>
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{level}</span>
          <h2 className="text-sm font-medium">{LEVEL_NAME[level]}</h2>
          {origin && <OriginBadge origin={origin} />}
          <div className="ml-auto flex flex-wrap gap-1">
            {level > 1 && (
              <Pill className="h-7 text-[11px]" disabled={!!busy || (level > 2 && !levelPresent(state, (level - 1) as Level))} onClick={() => void propose(level)} title={cost}>
                {busy === `propose-${level}` ? <Loader2 className="animate-spin" /> : present ? <RefreshCw /> : <Sparkles />}
                {present ? "Régénérer" : "Proposer"}
              </Pill>
            )}
            {present && state.validatedLevel < level && (
              <Pill className="h-7 bg-origin-validated/15 text-[11px] text-origin-validated hover:bg-origin-validated/25" disabled={!!busy} onClick={() => void validate(level)}>
                {busy === `validate-${level}` ? <Loader2 className="animate-spin" /> : <Check />} Valider ce niveau
              </Pill>
            )}
          </div>
        </header>
        {body}
        {deepest && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" disabled={!!busy} onClick={() => void (covered(state, (level + 1) as Level) ? document.querySelector(`[data-level="${level + 1}"]`)?.scrollIntoView({ behavior: "smooth" }) : propose((level + 1) as Level))} title={cost}>
              {busy === `propose-${level + 1}` ? <Loader2 className="animate-spin" /> : <ArrowDown />} Descendre au niveau {level + 1} · {LEVEL_NAME[(level + 1) as Level]}
            </Button>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 pt-3 pb-4">
      {/* Brief + gauge */}
      <aside className="island flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto p-4">
        <div>
          <h1 className="text-sm font-medium">Brief</h1>
          <p className="text-[11px] text-muted-foreground">Colle ton brief : une phrase, un concept ou un découpage complet.</p>
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={14}
          placeholder="Une femme attend sur un quai un train qui ne vient jamais."
          className="min-h-48 w-full flex-1 resize-none rounded-md bg-surface p-3 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
        />
        <Button disabled={!brief.trim() || !!busy} onClick={() => void act("analyze", `${url}/analyze`, { briefRaw: brief })}>
          {busy === "analyze" ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {state.diagnosis ? "Réanalyser le brief" : "Analyser le brief"}
        </Button>
        <p className="-mt-1 text-center text-[10px] text-muted-foreground">
          {cost}
          {!view.llm.mock && !view.llm.model && <span className="text-destructive"> · NIKKA_LLM_MODEL manquant dans .env.local</span>}
        </p>
        {state.diagnosis && state.validatedLevel > 0 && (
          <p className="-mt-2 text-center text-[10px] text-origin-proposed">Réanalyser repart de zéro (les références et plans déjà créés restent).</p>
        )}

        {state.diagnosis && (
          <div className="rounded-md bg-surface-2 p-3">
            <div className="mb-2 text-[10px] tracking-wide text-muted-foreground uppercase">Maturité</div>
            <div className="flex gap-1" aria-label={`Niveau ${state.diagnosis.level} sur 4`}>
              {([1, 2, 3, 4] as const).map((l) => (
                <div key={l} className="flex-1">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      background: state.validatedLevel >= l ? ORIGIN_COLOR.validated : state.diagnosis!.level >= l ? ORIGIN_COLOR.extracted : "var(--border)",
                    }}
                  />
                  <div className={cn("mt-1 text-[9px]", state.diagnosis!.level >= l ? "text-foreground" : "text-muted-foreground")}>{LEVEL_NAME[l]}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs">{state.diagnosis.summary}</p>
            {(["concept", "treatment", "breakdown"] as const).map((k, i) =>
              state.diagnosis!.gaps[k].length ? (
                <p key={k} className="mt-1 text-[10px] text-muted-foreground">
                  <span className="text-foreground/80">{LEVEL_NAME[(i + 2) as Level]}</span> — manque : {state.diagnosis!.gaps[k].join(", ")}
                </p>
              ) : null,
            )}
          </div>
        )}
        {error && <p className="rounded-md bg-destructive/10 p-2 text-[11px] text-destructive">{error}</p>}
      </aside>

      {/* Levels */}
      <div className="min-w-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {!state.diagnosis && (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div>
              <p className="text-sm text-foreground">Rien à digérer pour l&apos;instant</p>
              <p className="mt-1">NIKKA lit le brief, mesure sa maturité (idée → concept → traitement → découpage),</p>
              <p>extrait fidèlement ce qui y est, puis propose le premier niveau manquant.</p>
            </div>
          </div>
        )}
        {state.diagnosis && (
          <>
            {panel(
              1,
              state.idea && (
                <div className="flex items-start gap-2">
                  <EditText value={state.idea.value} onCommit={(v) => void update(1, { value: v, origin: "validated" })} />
                  <OriginBadge origin={state.idea.origin} className="mt-2" />
                </div>
              ),
              !!state.idea,
            )}
            {panel(2, <ConceptLevel state={state} busy={!!busy} onChoose={(i) => void act("choose", `${url}/choose`, { index: i })} onUpdate={(c) => void update(2, c)} />, !!state.concept || !!state.conceptOptions)}
            {(state.treatment || state.validatedLevel >= 2 || state.diagnosis.level >= 2) &&
              panel(3, state.treatment ? <TreatmentLevel t={state.treatment} applied={state.validatedLevel >= 3} onUpdate={(t) => void update(3, t)} /> : <Empty />, !!state.treatment)}
            {(state.breakdown || state.validatedLevel >= 3) &&
              panel(4, state.breakdown ? <BreakdownLevel b={state.breakdown} t={state.treatment} applied={state.validatedLevel >= 4} onUpdate={(b) => void update(4, b)} /> : <Empty />, !!state.breakdown)}
          </>
        )}
      </div>
    </div>
  );
}

function levelPresent(state: DigestState, level: Level) {
  return level === 1 ? !!state.idea : level === 2 ? !!state.concept : level === 3 ? !!state.treatment : !!state.breakdown;
}

/** The brief itself covers this level: descending just shows it (otherwise it is proposed, keeping what the brief stated). */
function covered(state: DigestState, level: Level) {
  return levelPresent(state, level) && (state.diagnosis?.level ?? 1) >= level;
}

function Empty() {
  return <p className="text-[11px] text-muted-foreground">Pas encore de contenu : « Proposer » le génère à partir des niveaux au-dessus.</p>;
}

// --- level 2 --------------------------------------------------------------------------

const CONCEPT_FIELDS: { key: keyof StoredConcept; label: string; rows: number }[] = [
  { key: "pitch", label: "Pitch", rows: 2 },
  { key: "intention", label: "Intention", rows: 2 },
  { key: "tone", label: "Ton", rows: 1 },
  { key: "audience", label: "Cible", rows: 1 },
  { key: "format", label: "Format", rows: 1 },
];

function ConceptLevel({ state, busy, onChoose, onUpdate }: { state: DigestState; busy: boolean; onChoose: (i: number) => void; onUpdate: (c: StoredConcept) => void }) {
  const c = state.concept;
  return (
    <div className="space-y-3">
      {state.conceptOptions && (
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">Pistes proposées à partir de l&apos;idée : choisis-en une, puis ajuste-la.</p>
          <div className="grid gap-2 md:grid-cols-3">
            {state.conceptOptions.map((o, i) => {
              const chosen = c?.pitch.value === o.pitch;
              return (
                <div key={i} className={cn("flex flex-col rounded-md border bg-surface-2 p-3", chosen && "border-origin-proposed/60")}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{o.title}</span>
                    <OriginBadge origin="proposed" />
                  </div>
                  <p className="text-[11px] leading-relaxed">{o.pitch}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">{o.tone} · {o.format} · {o.audience}</p>
                  <Pill className="mt-2 h-7 self-start text-[11px]" disabled={busy || chosen} onClick={() => onChoose(i)}>
                    {chosen ? <><Check /> Choisie</> : "Choisir cette piste"}
                  </Pill>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {c && (
        <div className="grid gap-2">
          {CONCEPT_FIELDS.map(({ key, label, rows }) => (
            <div key={key} className="grid grid-cols-[90px_1fr_auto] items-start gap-2">
              <span className="pt-1.5 text-[11px] text-muted-foreground">{label}</span>
              <EditText value={c[key].value} rows={rows} placeholder="—" onCommit={(v) => onUpdate({ ...c, [key]: { value: v, origin: "validated" } })} />
              <OriginBadge origin={c[key].origin} className="mt-2" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- level 3 --------------------------------------------------------------------------

const ENTITY_TAGS = { character: TAG_LABEL.character, location: TAG_LABEL.location, object: TAG_LABEL.object, look: TAG_LABEL.look } as const;

function TreatmentLevel({ t, applied, onUpdate }: { t: StoredTreatment; applied: boolean; onUpdate: (t: StoredTreatment) => void }) {
  const setEntity = (i: number, patch: Partial<StoredTreatment["entities"][number]>) =>
    onUpdate({ ...t, entities: t.entities.map((e, j) => (j === i ? { ...e, ...patch, origin: "validated" } : e)) });
  const setSeq = (i: number, patch: Partial<StoredTreatment["sequences"][number]>) =>
    onUpdate({ ...t, sequences: t.sequences.map((s, j) => (j === i ? { ...s, ...patch, origin: "validated" } : s)) });
  const locations = t.entities.filter((e) => e.tag === "location").map((e) => e.name);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[90px_1fr_auto] items-start gap-2">
        <span className="pt-1.5 text-[11px] text-muted-foreground">Direction artistique</span>
        <EditText value={t.artDirection.value} placeholder="—" onCommit={(v) => onUpdate({ ...t, artDirection: { value: v, origin: "validated" } })} />
        <OriginBadge origin={t.artDirection.origin} className="mt-2" />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Entités → références de la bible{applied && " (déjà créées : leur descripteur se modifie dans la fiche de la bible)"}</span>
          <Pill className="h-6 text-[10px]" onClick={() => onUpdate({ ...t, entities: [...t.entities, { name: "Nouvelle entité", tag: "character", descriptor: "", origin: "validated" }] })}>
            <Plus /> Entité
          </Pill>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {t.entities.map((e, i) => (
            <div key={i} className="rounded-md bg-surface-2 p-2">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: TAG_COLOR_VAR[e.tag] }} />
                <input
                  defaultValue={e.name}
                  key={e.name}
                  onBlur={(ev) => ev.target.value.trim() && ev.target.value !== e.name && setEntity(i, { name: ev.target.value.trim() })}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                />
                <Select value={e.tag} options={ENTITY_TAGS} onChange={(tag) => setEntity(i, { tag })} className="h-6" />
                <OriginBadge origin={e.origin} />
                <button type="button" aria-label="Supprimer" className="text-muted-foreground hover:text-destructive" onClick={() => onUpdate({ ...t, entities: t.entities.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <EditText value={e.descriptor} placeholder="Descripteur visuel (injecté tel quel dans les prompts)" onCommit={(descriptor) => setEntity(i, { descriptor })} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Séquences</span>
          <Pill className="h-6 text-[10px]" onClick={() => onUpdate({ ...t, sequences: [...t.sequences, { title: `Séquence ${t.sequences.length + 1}`, summary: "", origin: "validated" }] })}>
            <Plus /> Séquence
          </Pill>
        </div>
        <ol className="space-y-2">
          {t.sequences.map((s, i) => (
            <li key={i} className="grid grid-cols-[24px_1fr_auto] items-start gap-2 rounded-md bg-surface-2 p-2">
              <span className="pt-1 font-mono text-[11px] text-muted-foreground">{i + 1}</span>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={s.title}
                    key={s.title}
                    onBlur={(ev) => ev.target.value.trim() && ev.target.value !== s.title && setSeq(i, { title: ev.target.value.trim() })}
                    className="min-w-0 flex-1 bg-transparent text-xs font-medium outline-none"
                  />
                  {locations.length > 0 && (
                    <select value={s.location ?? ""} onChange={(ev) => setSeq(i, { location: ev.target.value || undefined })} className="h-6 rounded-md bg-surface px-1 text-[10px] outline-none">
                      <option value="">Lieu —</option>
                      {locations.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                  )}
                </div>
                <EditText value={s.summary} placeholder="Résumé" onCommit={(summary) => setSeq(i, { summary })} />
              </div>
              <div className="flex flex-col items-end gap-1">
                <OriginBadge origin={s.origin} />
                <button type="button" aria-label="Supprimer" className="text-muted-foreground hover:text-destructive" onClick={() => onUpdate({ ...t, sequences: t.sequences.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// --- level 4 --------------------------------------------------------------------------

type Shot = StoredBreakdown["sequences"][number]["shots"][number];

function BreakdownLevel({ b, t, applied, onUpdate }: { b: StoredBreakdown; t?: StoredTreatment; applied: boolean; onUpdate: (b: StoredBreakdown) => void }) {
  const setShot = (si: number, i: number, patch: Partial<Shot>) =>
    onUpdate({
      sequences: b.sequences.map((s, j) => (j === si ? { ...s, shots: s.shots.map((sh, k) => (k === i ? { ...sh, ...patch, origin: "validated" } : sh)) } : s)),
    });
  const setSeq = (si: number, shots: Shot[]) => onUpdate({ sequences: b.sequences.map((s, j) => (j === si ? { ...s, shots } : s)) });
  const entities = t?.entities ?? [];
  const total = b.sequences.reduce((n, s) => n + s.shots.reduce((d, sh) => d + sh.durationSec, 0), 0);
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">
        {b.sequences.reduce((n, s) => n + s.shots.length, 0)} plans · {Math.round(total)} s.{" "}
        {applied ? "Plans créés dans le storyboard." : "« Valider ce niveau » crée les séquences et les plans dans le storyboard (sans rien générer)."}
      </p>
      {b.sequences.map((s, si) => (
        <div key={si}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">Séq. {si + 1}</span>
            <input
              defaultValue={s.title.value}
              key={s.title.value}
              onBlur={(ev) =>
                ev.target.value.trim() && ev.target.value !== s.title.value &&
                onUpdate({ sequences: b.sequences.map((x, j) => (j === si ? { ...x, title: { value: ev.target.value.trim(), origin: "validated" } } : x)) })
              }
              className="min-w-0 flex-1 bg-transparent text-xs font-medium outline-none"
            />
            <OriginBadge origin={s.title.origin} />
          </div>
          <div className="space-y-1.5">
            {s.shots.map((sh, i) => (
              <div key={i} className="grid grid-cols-[34px_1fr_auto] items-start gap-2 rounded-md bg-surface-2 p-2">
                <span className="pt-1.5 font-mono text-[11px] text-muted-foreground">
                  {si + 1}.{i + 1}
                </span>
                <div className="min-w-0 space-y-1.5">
                  <EditText value={sh.description} rows={1} onCommit={(description) => setShot(si, i, { description })} />
                  <div className="flex flex-wrap items-center gap-1">
                    <Select value={sh.camera.scale} options={SCALE_LABEL} onChange={(scale) => setShot(si, i, { camera: { ...sh.camera, scale } })} />
                    <Select value={sh.camera.angle} options={ANGLE_LABEL} onChange={(angle) => setShot(si, i, { camera: { ...sh.camera, angle } })} />
                    <Select value={sh.camera.movement} options={MOVEMENT_LABEL} onChange={(movement) => setShot(si, i, { camera: { ...sh.camera, movement } })} />
                    <label className="flex items-center gap-1 rounded-md bg-surface px-1.5 text-[11px]">
                      <input
                        type="number"
                        min={1}
                        max={60}
                        defaultValue={sh.durationSec}
                        key={sh.durationSec}
                        onBlur={(ev) => {
                          const d = Number(ev.target.value);
                          if (d > 0 && d <= 60 && d !== sh.durationSec) setShot(si, i, { durationSec: d });
                        }}
                        className="h-7 w-9 bg-transparent font-mono outline-none"
                      />
                      s
                    </label>
                    {entities.map((e) => {
                      const on = sh.refs.some((r) => r.toLowerCase() === e.name.toLowerCase());
                      return (
                        <button
                          key={e.name}
                          type="button"
                          onClick={() => setShot(si, i, { refs: on ? sh.refs.filter((r) => r.toLowerCase() !== e.name.toLowerCase()) : [...sh.refs, e.name] })}
                          className={cn("flex h-6 items-center gap-1 rounded-full border px-2 text-[10px]", on ? "border-transparent bg-surface text-foreground" : "border-dashed text-muted-foreground/60")}
                          title={on ? "Retirer la référence de ce plan" : "Brancher cette référence sur le plan"}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[e.tag] }} />
                          {e.name}
                        </button>
                      );
                    })}
                  </div>
                  {(sh.dialogue !== undefined || sh.sound !== undefined) && (
                    <div className="grid gap-1 md:grid-cols-2">
                      {sh.dialogue !== undefined && <EditText value={sh.dialogue} rows={1} placeholder="Dialogue" onCommit={(dialogue) => setShot(si, i, { dialogue })} />}
                      {sh.sound !== undefined && <EditText value={sh.sound} rows={1} placeholder="Son" onCommit={(sound) => setShot(si, i, { sound })} />}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <OriginBadge origin={sh.origin} />
                  <button type="button" aria-label="Supprimer le plan" className="text-muted-foreground hover:text-destructive" onClick={() => setSeq(si, s.shots.filter((_, k) => k !== i))}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <Pill
              className="h-6 text-[10px]"
              onClick={() =>
                setSeq(si, [...s.shots, { description: "Nouveau plan", durationSec: 4, camera: { scale: "medium", angle: "eye_level", movement: "static" }, refs: [], origin: "validated" }])
              }
            >
              <Plus /> Plan
            </Pill>
          </div>
        </div>
      ))}
    </div>
  );
}
