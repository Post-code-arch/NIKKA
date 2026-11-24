"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconPill } from "@/components/ui/pill";
import type { Shot, Take } from "@/db/schema";
import { formatUsd } from "@/lib/cost/estimate";
import type { ModelInfo } from "@/lib/models/registry";
import type { ShotPromptPreview } from "@/lib/prompt/shot";
import { MOVEMENT_LABEL } from "@/lib/camera/labels";
import { api, ApiError } from "@/lib/store/api";

type Estimate = { costEstimatedUsd: number; thresholdUsd: number; needsConfirmation: boolean };

/**
 * Launch one generation for a shot. The estimated cost is always shown
 * before launching; above the project threshold an explicit tick is required.
 */
export function GenerateDialog({
  shot,
  mode,
  parentTake,
  defaultModelId,
  onClose,
  onLaunched,
}: {
  shot: Shot;
  mode: "keyframe" | "video";
  parentTake?: Take;
  /** The project's default model for this stage. */
  defaultModelId?: string | null;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const kinds = mode === "video" ? ["i2v"] : ["t2i", "i2i"];
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [mock, setMock] = useState(false);
  const [modelId, setModelId] = useState(defaultModelId ?? "");
  // The assembled prompt (descriptors + action + camera + look) until the user edits it.
  const [prompt, setPrompt] = useState("");
  const [edited, setEdited] = useState(false);
  const [preview, setPreview] = useState<ShotPromptPreview | null>(null);
  const [estimateFor, setEstimateFor] = useState<(Estimate & { modelId: string }) | null>(null);
  const estimate = estimateFor?.modelId === modelId ? estimateFor : null;
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ mock: boolean; models: ModelInfo[] }>("/api/models").then((r) => {
      const usable = r.models.filter((m) => kinds.includes(m.kind));
      setModels(usable);
      setMock(r.mock);
      setModelId((cur) => (usable.some((m) => m.id === cur) ? cur : usable[0]?.id || ""));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!modelId) return;
    const q = new URLSearchParams({ [mode]: modelId });
    void api<ShotPromptPreview>(`/api/shots/${shot.id}/prompt?${q}`).then((p) => {
      setPreview(p);
      if (!edited) setPrompt(p[mode].prompt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, mode, shot.id]);

  useEffect(() => {
    if (!modelId) return;
    void api<Estimate>(`/api/shots/${shot.id}/estimate`, { body: { modelId, durationSec: shot.durationSec } })
      .then((e) => setEstimateFor({ ...e, modelId }))
      .catch((e) => setError(e.message));
  }, [modelId, shot.id, shot.durationSec]);

  const selectedModel = models?.find((m) => m.id === modelId);
  const movementIssue = mode === "video" && preview && !preview.movement.supported;
  const needsRefs = selectedModel?.kind === "i2i" && !(preview?.references?.picked.length);

  const canLaunch =
    !!modelId && !!prompt.trim() && !!estimate && !needsRefs && (!estimate.needsConfirmation || confirmed) && !busy;

  const launch = async () => {
    if (!estimate) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/shots/${shot.id}/takes`, {
        body: {
          modelId,
          stage: mode,
          prompt: prompt.trim(),
          durationSec: shot.durationSec,
          parentTakeId: parentTake?.id,
          confirmedCostUsd: estimate.needsConfirmation ? estimate.costEstimatedUsd : undefined,
        },
      });
      onLaunched();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="island w-[420px] p-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium">{mode === "video" ? "Animer en vidéo" : "Générer une image clé"}</h2>
          <IconPill aria-label="Fermer" className="bg-transparent" onClick={onClose}>
            <X />
          </IconPill>
        </div>

        {models && models.length === 0 && (
          <p className="mb-3 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
            Aucun modèle n&apos;est encore validé dans le registre. Lance l&apos;app avec{" "}
            <code className="font-mono">NIKKA_MOCK_ATLAS=1</code> pour tester sans dépenser.
          </p>
        )}

        <label className="mb-1 block text-[11px] text-muted-foreground">Modèle</label>
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            setConfirmed(false);
          }}
          className="mb-3 h-9 w-full rounded-md bg-surface-2 px-2 text-xs outline-none"
        >
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {formatUsd(m.pricing.usd)}/{m.pricing.unit === "second" ? "s" : "image"}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[11px] text-muted-foreground">
          {mode === "video" ? "Mouvement / action" : "Prompt"}
        </label>
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setEdited(true);
          }}
          rows={4}
          placeholder={mode === "video" ? "Travelling avant lent…" : "Décris l'image clé…"}
          className="mb-3 w-full resize-none rounded-md bg-surface-2 p-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />

        <div className="mb-3 flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Coût estimé{mode === "video" ? ` (${shot.durationSec}s)` : ""}
            {mock && " · mock, rien n'est facturé"}
          </span>
          <span className="font-mono">{estimate ? formatUsd(estimate.costEstimatedUsd) : "…"}</span>
        </div>

        {estimate?.needsConfirmation && (
          <label className="mb-3 flex items-start gap-2 rounded-md border border-origin-proposed/40 bg-origin-proposed/10 p-2 text-xs">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>
              <AlertTriangle className="mr-1 inline size-3.5 text-origin-proposed" />
              Au-dessus du seuil de {formatUsd(estimate.thresholdUsd)} : je confirme cette dépense.
            </span>
          </label>
        )}

        {movementIssue && (
          <p className="mb-3 rounded-md border border-origin-proposed/40 bg-origin-proposed/10 p-2 text-xs">
            <AlertTriangle className="mr-1 inline size-3.5 text-origin-proposed" />
            Ce modèle ne sait pas faire « {MOVEMENT_LABEL[preview.movement.movement]} ».
            {preview.movement.alternatives.length > 0 && <> Modèle compatible : {preview.movement.alternatives.map((a) => a.label).join(", ")}.</>}
          </p>
        )}
        {needsRefs && (
          <p className="mb-3 text-xs text-origin-proposed">
            Ce modèle a besoin d&apos;images de référence : branche une référence de la bible (avec des vues) dans la fiche du plan.
          </p>
        )}
        {preview?.references && preview.references.picked.length > 0 && selectedModel?.kind === "i2i" && (
          <p className="mb-3 text-[11px] text-muted-foreground">
            {preview.references.picked.length} vue{preview.references.picked.length > 1 ? "s" : ""} de référence envoyée
            {preview.references.picked.length > 1 ? "s" : ""} : {preview.references.picked.map((p) => p.refName).filter((v, i, a) => a.indexOf(v) === i).join(", ")}.
          </p>
        )}
        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        <Button className="w-full" disabled={!canLaunch} onClick={() => void launch()}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Lancer · {estimate ? formatUsd(estimate.costEstimatedUsd) : "…"}
        </Button>
      </div>
    </div>
  );
}
