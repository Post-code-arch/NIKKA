"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { ReferenceVariant } from "@/db/schema";
import { formatUsd } from "@/lib/cost/estimate";
import type { ModelInfo } from "@/lib/models/registry";
import { PACK_VIEWS, VIEW_LABEL } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import type { ReferenceDetailData } from "./reference-detail";
import { Thumb } from "./view-thumb";

type Estimate = { costEstimatedUsd: number; thresholdUsd: number; needsConfirmation: boolean };

/**
 * Generates the standard views of a reference from a source image (or the
 * descriptor alone), then lets the user validate them one by one (PRD §7).
 */
export function PackAssistant({
  reference,
  variant,
  onLaunched,
  onValidated,
}: {
  reference: ReferenceDetailData;
  variant: ReferenceVariant;
  onLaunched: () => void;
  onValidated: () => Promise<void>;
}) {
  const packViews = PACK_VIEWS[reference.tag] ?? ["untagged"];
  const [sourceAssetId, setSourceAssetId] = useState<string>(variant.views[0]?.assetId ?? "");
  const [selected, setSelected] = useState<boolean[]>(() =>
    packViews.map((v) => !variant.views.some((x) => x.view === v)),
  );
  const kind = sourceAssetId ? "i2i" : "t2i";
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [estimateFor, setEstimateFor] = useState<(Estimate & { key: string }) | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const views = packViews.filter((_, i) => selected[i]);
  const key = `${modelId}|${sourceAssetId}|${views.join(",")}`;
  const estimate = estimateFor?.key === key ? estimateFor : null;

  useEffect(() => {
    void api<{ models: ModelInfo[] }>(`/api/models?kind=${kind}`).then((r) => {
      const usable = kind === "i2i" ? r.models.filter((m) => (m.maxReferenceImages ?? 0) > 0) : r.models;
      setModels(usable);
      setModelId(usable[0]?.id ?? "");
    });
  }, [kind]);

  useEffect(() => {
    if (!modelId || views.length === 0) return;
    void api<Estimate>(`/api/references/${reference.id}/pack`, {
      body: { variantId: variant.id, views, modelId, sourceAssetId: sourceAssetId || undefined, estimateOnly: true },
    })
      .then((e) => setEstimateFor({ ...e, key }))
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reference.id, variant.id]);

  const launch = async () => {
    if (!estimate) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/references/${reference.id}/pack`, {
        body: {
          variantId: variant.id,
          views,
          modelId,
          sourceAssetId: sourceAssetId || undefined,
          confirmedCostUsd: estimate.needsConfirmation ? estimate.costEstimatedUsd : undefined,
        },
      });
      setConfirmed(false);
      onLaunched();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const candidates = useMemo(
    () => reference.generations.filter((g) => g.variantId === variant.id),
    [reference.generations, variant.id],
  );
  const inVariant = new Set(variant.views.map((v) => v.assetId));
  const noDescriptor = !sourceAssetId && !reference.descriptor.trim();

  return (
    <div className="rounded-[12px] border p-3">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium">
        <Sparkles className="size-3.5" /> Assistant pack · {variant.name}
      </h3>

      <label className="mb-1 block text-[11px] text-muted-foreground">Image source</label>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSourceAssetId("")}
          className={cn(
            "h-14 rounded-md border-2 px-3 text-[11px]",
            !sourceAssetId ? "border-foreground/80" : "border-transparent bg-surface-2 text-muted-foreground",
          )}
        >
          Description seule
        </button>
        {variant.views.map((v, i) => (
          <button
            key={`${v.assetId}-${i}`}
            type="button"
            onClick={() => setSourceAssetId(v.assetId)}
            className={cn("rounded-md border-2", sourceAssetId === v.assetId ? "border-foreground/80" : "border-transparent")}
          >
            <Thumb assetId={v.assetId} className="size-14" />
          </button>
        ))}
      </div>

      <label className="mb-1 block text-[11px] text-muted-foreground">Vues à générer</label>
      <div className="mb-3 flex flex-wrap gap-1">
        {packViews.map((v, i) => (
          <Pill key={i} active={selected[i]} onClick={() => setSelected((s) => s.map((x, j) => (j === i ? !x : x)))}>
            {selected[i] && <Check />}
            {VIEW_LABEL[v]}
          </Pill>
        ))}
      </div>

      <label className="mb-1 block text-[11px] text-muted-foreground">
        Modèle {sourceAssetId ? "(édition multi-références)" : "(texte → image)"}
      </label>
      <select
        value={modelId}
        onChange={(e) => {
          setModelId(e.target.value);
          setConfirmed(false);
        }}
        className="mb-3 h-9 w-full rounded-md bg-surface-2 px-2 text-xs outline-none"
      >
        {models.length === 0 && <option value="">Aucun modèle disponible</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {formatUsd(m.pricing.usd)}/image
          </option>
        ))}
      </select>

      {noDescriptor && (
        <p className="mb-3 text-[11px] text-origin-proposed">Sans image source, écris d&apos;abord le descripteur.</p>
      )}
      {estimate?.needsConfirmation && (
        <label className="mb-3 flex items-start gap-2 rounded-md border border-origin-proposed/40 bg-origin-proposed/10 p-2 text-xs">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          <span>
            <AlertTriangle className="mr-1 inline size-3.5 text-origin-proposed" />
            Au-dessus du seuil de {formatUsd(estimate.thresholdUsd)} : je confirme cette dépense.
          </span>
        </label>
      )}
      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      <Button
        className="w-full"
        disabled={!estimate || views.length === 0 || noDescriptor || busy || (estimate.needsConfirmation && !confirmed)}
        onClick={() => void launch()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Générer {views.length} vue{views.length > 1 ? "s" : ""} · {estimate ? formatUsd(estimate.costEstimatedUsd) : "…"}
      </Button>

      {candidates.length > 0 && (
        <>
          <h4 className="mt-4 mb-2 text-[11px] text-muted-foreground">Propositions · valide celles à garder</h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {candidates.map((g) => {
              const kept = g.validated || (g.assetId ? inVariant.has(g.assetId) : false);
              return (
                <div key={g.id} className={cn("rounded-[10px] bg-surface-2 p-1.5", kept && "ring-1 ring-origin-validated/70")}>
                  <Thumb assetId={g.assetId} status={g.status} className="aspect-square w-full" />
                  <div className="mt-1 flex items-center justify-between px-0.5 text-[10px] text-muted-foreground">
                    <span>{VIEW_LABEL[g.view]}</span>
                    {kept && <span className="text-origin-validated">Validée</span>}
                  </div>
                  {g.status === "failed" && <p className="truncate px-0.5 text-[10px] text-destructive" title={g.error ?? ""}>{g.error}</p>}
                  <div className="mt-1 flex gap-1">
                    <Pill
                      className="h-7 flex-1 justify-center px-1 text-[10px]"
                      disabled={g.status !== "completed" || kept}
                      onClick={() => void api(`/api/ref-generations/${g.id}/validate`, { body: {} }).then(onValidated)}
                    >
                      <Check /> Valider
                    </Pill>
                    <Pill
                      className="h-7 px-2 text-[10px]"
                      title="Nouvelle proposition pour cette vue"
                      disabled={g.status === "queued" || g.status === "processing"}
                      onClick={() =>
                        void api(`/api/ref-generations/${g.id}/regenerate`, { body: {} })
                          .then(onLaunched)
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      <RotateCcw />
                    </Pill>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
