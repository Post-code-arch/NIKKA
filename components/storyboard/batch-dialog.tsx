"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/bible/reference-detail";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/cost/estimate";
import type { ProjectTree } from "@/lib/projects/queries";
import type { BatchPlan, BatchStage } from "@/lib/storyboard/ops";
import { api } from "@/lib/store/api";

export const STAGE_LABEL: Record<BatchStage, string> = {
  sketch: "Crayonné",
  keyframe: "Images clés",
  video: "Animation",
};

const STAGE_HINT: Record<BatchStage, string> = {
  sketch: "Esquisse rapide et bon marché pour juger le découpage.",
  keyframe: "Images en qualité, avec les références des plans.",
  video: "Anime l'image clé retenue de chaque plan.",
};

/**
 * Batch generation of several shots (a sequence, or the selection). The
 * total estimated cost is always shown and must be confirmed (PRD §10–11).
 */
export function BatchDialog({
  project,
  shotIds,
  stage,
  title,
  onClose,
  onLaunched,
}: {
  project: ProjectTree;
  shotIds: string[];
  stage: BatchStage;
  title: string;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [plan, setPlan] = useState<BatchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const numbers = new Map(project.sequences.flatMap((s, i) => s.shots.map((sh, j) => [sh.id, `${i + 1}.${j + 1}`] as const)));

  useEffect(() => {
    void api<BatchPlan>("/api/storyboard/batch", { body: { shotIds, stage, estimateOnly: true } })
      .then(setPlan)
      .catch((e: Error) => setError(e.message));
  }, [shotIds, stage]);

  const launch = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ results: { error?: string }[] }>("/api/storyboard/batch", { body: { shotIds, stage, confirmedTotalUsd: plan.totalUsd } });
      const failed = r.results.filter((x) => x.error);
      onLaunched();
      if (failed.length) setError(`${failed.length} plan(s) non lancé(s) : ${failed[0].error}`);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const skipped = plan?.items.filter((i) => i.skipped) ?? [];
  return (
    <Modal onClose={onClose}>
      <h2 className="text-sm font-medium">
        {STAGE_LABEL[stage]} · {title}
      </h2>
      <p className="mb-3 text-[11px] text-muted-foreground">{STAGE_HINT[stage]}</p>
      {!plan && !error && <Loader2 className="mx-auto my-6 size-4 animate-spin text-muted-foreground" />}
      {plan && (
        <>
          <div className="mb-3 max-h-56 space-y-0.5 overflow-y-auto rounded-md bg-surface-2 p-2 text-[11px]">
            {plan.items.map((i) => (
              <div key={i.shotId} className="flex justify-between gap-3">
                <span className="font-mono">{numbers.get(i.shotId) ?? "?"}</span>
                {i.skipped ? (
                  <span className="truncate text-muted-foreground">ignoré : {i.skipped}</span>
                ) : (
                  <span className="truncate text-muted-foreground">{i.modelId}</span>
                )}
                <span className="font-mono">{i.skipped ? "—" : formatUsd(i.costEstimatedUsd)}</span>
              </div>
            ))}
          </div>
          <div className="mb-3 flex justify-between border-t pt-2 text-xs">
            <span>
              {plan.count} plan{plan.count > 1 ? "s" : ""} à générer
              {skipped.length > 0 && <span className="text-muted-foreground"> · {skipped.length} ignoré{skipped.length > 1 ? "s" : ""}</span>}
            </span>
            <span className="font-mono">Total estimé {formatUsd(plan.totalUsd)}</span>
          </div>
          {plan.totalUsd > plan.thresholdUsd && (
            <p className="mb-3 text-xs text-origin-proposed">
              <AlertTriangle className="mr-1 inline size-3.5" />
              Au-dessus du seuil de {formatUsd(plan.thresholdUsd)}.
            </p>
          )}
        </>
      )}
      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
      <Button className="w-full" disabled={busy || !plan || plan.count === 0} onClick={() => void launch()}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {plan && plan.count > 0 ? `Lancer ${plan.count} génération${plan.count > 1 ? "s" : ""} · ${formatUsd(plan.totalUsd)}` : "Rien à lancer"}
      </Button>
    </Modal>
  );
}
