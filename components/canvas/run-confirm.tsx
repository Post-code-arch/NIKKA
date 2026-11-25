"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/bible/reference-detail";
import { formatUsd } from "@/lib/cost/estimate";
import type { RunEstimate } from "@/lib/graph/run";
import { api, ApiError } from "@/lib/store/api";

export type RunRequest = { shotId: string; nodeId: string; variants?: number };

/**
 * Every paid run goes through here: estimate first; above the threshold or
 * for a batch (variants), an explicit confirmation of the total (PRD §11).
 */
export function useRunner(onDone: () => void) {
  const [pending, setPending] = useState<{ req: RunRequest; estimate: RunEstimate } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const launch = async (req: RunRequest, confirmedCostUsd?: number) => {
    setBusy(true);
    try {
      await api(`/api/shots/${req.shotId}/run`, { body: { ...req, shotId: undefined, confirmedCostUsd } });
      setPending(null);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async (req: RunRequest) => {
    setError(null);
    try {
      const { estimate } = await api<{ estimate: RunEstimate }>(`/api/shots/${req.shotId}/run`, {
        body: { ...req, shotId: undefined, estimateOnly: true },
      });
      if (estimate.needsConfirmation) setPending({ req, estimate });
      else await launch(req);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const dialog = (
    <>
      {pending && (
        <Modal onClose={() => setPending(null)}>
          <h2 className="mb-3 text-sm font-medium">Confirmer la génération</h2>
          <div className="mb-3 space-y-1 rounded-md bg-surface-2 p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prises</span>
              <span className="font-mono">{pending.estimate.variants}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Par prise</span>
              <span className="font-mono">{formatUsd(pending.estimate.unitCostUsd)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span>Total estimé</span>
              <span className="font-mono">{formatUsd(pending.estimate.costEstimatedUsd)}</span>
            </div>
          </div>
          {pending.estimate.costEstimatedUsd > pending.estimate.thresholdUsd && (
            <p className="mb-3 text-xs text-origin-proposed">
              <AlertTriangle className="mr-1 inline size-3.5" />
              Au-dessus du seuil de {formatUsd(pending.estimate.thresholdUsd)}.
            </p>
          )}
          {error && <p className="mb-3 text-xs text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy} onClick={() => void launch(pending.req, pending.estimate.costEstimatedUsd)}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Lancer · {formatUsd(pending.estimate.costEstimatedUsd)}
          </Button>
        </Modal>
      )}
      {error && !pending && (
        <div className="island fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-3 py-2 text-xs text-destructive" onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );

  return { run, dialog };
}
