"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";
import { IconPill } from "@/components/ui/pill";
import type { CatalogItem, ModelCaps } from "@/app/api/models/catalog/route";
import type { ModelKind } from "@/lib/models/types";
import { api } from "@/lib/store/api";
import { reloadModels, useModels } from "@/lib/store/models";
import { cn } from "@/lib/utils";

export const KIND_LABEL: Record<ModelKind, string> = {
  t2i: "texte → image",
  i2i: "édition (références)",
  t2v: "texte → vidéo",
  i2v: "image → vidéo",
  v2v: "vidéo → vidéo",
  r2v: "références → vidéo",
  llm: "LLM",
};

type Filter = "refs" | "videoRefs" | "negative" | "startEnd";
const FILTER_LABEL: Record<Filter, string> = { refs: "réf", videoRefs: "vidéo réf", negative: "négatif", startEnd: "début + fin" };

export function price(usd: number | null | undefined, unit: string | null | undefined) {
  if (usd === null || usd === undefined) return "prix ?";
  const v = usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2);
  return `$${v}${unit ? ` / ${unit === "second" ? "s" : unit}` : ""}`;
}

/** What a model accepts, read from its schema. */
export function Badges({ caps }: { caps?: ModelCaps | null }) {
  if (!caps) return null;
  const list = [
    caps.refs ? `réf ×${caps.refs}` : null,
    caps.videoRefs ? `vidéo réf ×${caps.videoRefs}` : null,
    caps.negative ? "négatif" : null,
    caps.startEnd ? "début + fin" : null,
  ].filter(
    (b): b is string => !!b,
  );
  if (!list.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-0.5">
      {list.map((b) => (
        <span key={b} className="rounded bg-surface px-1 text-[8px] text-muted-foreground">
          {b}
        </span>
      ))}
    </span>
  );
}

/**
 * Model selector of a node: models already enabled, plus a search in the
 * Atlas catalog. Adding one builds its adapter from its published schema.
 * Badges say what each model accepts (reference images, negative prompt,
 * start + end frames); filters keep only those that do.
 */
export function ModelPicker({ kinds, value, onChange }: { kinds: ModelKind[]; value?: string; onChange: (id: string) => void }) {
  const kind = kinds[0];
  const data = useModels();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const kindsKey = kinds.join(",");

  const enabled: { id: string; label: string; price: string; caps?: ModelCaps }[] =
    kind === "llm"
      ? (data?.llms ?? []).map((m) => ({ id: m.id, label: m.label, price: data?.mock ? "gratuit" : `$${m.inputUsdPerM} / $${m.outputUsdPerM} par M` }))
      : (data?.models ?? [])
          .filter((m) => kinds.includes(m.kind))
          .map((m) => ({
            id: m.id,
            label: m.label,
            price: m.mock ? "gratuit (mock)" : price(m.pricing.usd, m.pricing.unit),
            caps: { refs: m.maxReferenceImages, videoRefs: m.maxReferenceVideos, negative: m.supportsNegativePrompt, startEnd: m.supportsStartEndFrames },
          }));
  const current = enabled.find((m) => m.id === value) ?? enabled[0];
  const pass = (caps?: ModelCaps | null) => filters.every((f) => !!caps?.[f]);

  useEffect(() => {
    if (!open || data?.mock !== false) return;
    let stale = false;
    const t = setTimeout(() => {
      void api<{ items: CatalogItem[] }>(`/api/models/catalog?kind=${kindsKey}&q=${encodeURIComponent(q)}`)
        .then((r) => !stale && setItems(r.items))
        .catch((e: Error) => !stale && setError(e.message));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, q, kindsKey, data?.mock]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const add = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await api("/api/models/enable", { body: { id } });
      await reloadModels();
      onChange(id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={box} className="nodrag relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 max-w-40 items-center gap-1 rounded-md bg-surface px-1.5 text-[11px] outline-none hover:bg-surface-2"
        title={current ? `${current.label} · ${current.price}` : "Choisir un modèle"}
      >
        <span className="truncate">{current?.label ?? "Choisir un modèle"}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="island nowheel absolute top-8 right-0 z-40 w-80 p-1.5 text-left">
          <div className="mb-1 flex items-center justify-between px-1.5 text-[10px] text-muted-foreground">
            Modèle · {kinds.map((k) => KIND_LABEL[k]).join(" / ")}
            <IconPill aria-label="Fermer" className="size-5 bg-transparent" onClick={() => setOpen(false)}>
              <X />
            </IconPill>
          </div>
          {kind !== "llm" && (
            <div className="mb-1 flex items-center gap-1 px-1.5">
              <span className="text-[9px] text-muted-foreground">Doit accepter :</span>
              {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilters((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]))}
                  className={cn(
                    "rounded-full border px-1.5 text-[9px]",
                    filters.includes(f) ? "border-foreground bg-foreground text-background" : "text-muted-foreground",
                  )}
                >
                  {FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          )}
          {enabled.length > 0 && <div className="px-2 pt-1 text-[9px] tracking-wide text-muted-foreground/70 uppercase">Activés</div>}
          {enabled
            .filter((m) => pass(m.caps))
            .map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
              >
                <Check className={cn("size-3 shrink-0", m.id === current?.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px]">{m.label}</span>
                  <Badges caps={m.caps} />
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{m.price}</span>
              </button>
            ))}

          {data?.mock ? (
            <p className="px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
              Mode mock : modèles factices, rien n&apos;est facturé. Le catalogue Atlas (et ses prix) s&apos;ouvre en mode réel.
            </p>
          ) : (
            <>
              <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-surface px-2">
                <Search className="size-3 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Chercher dans le catalogue Atlas…"
                  className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div className="mt-1 max-h-64 overflow-y-auto">
                {!items && !error && <Loader2 className="mx-auto my-3 size-3.5 animate-spin text-muted-foreground" />}
                {items?.length === 0 && <p className="px-2 py-2 text-[10px] text-muted-foreground">Aucun modèle trouvé.</p>}
                {items
                  ?.filter((i) => !i.enabled && (i.kind === "llm" || pass(i.caps)))
                  .map((i) => {
                    const usable = i.kind === "llm" || !!i.caps;
                    return (
                      <button
                        key={i.id}
                        type="button"
                        disabled={!!busy || !usable}
                        onClick={() => void add(i.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-50"
                        title={usable ? `${i.id} — ajouter (son schéma est lu pour configurer l'appel)` : `${i.id} — non pilotable : ${i.incompatible ?? ""}`}
                      >
                        {busy === i.id ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Plus className="size-3 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px]">{i.label}</span>
                          <span className="block truncate text-[9px] text-muted-foreground">{i.id}</span>
                          {usable ? <Badges caps={i.caps} /> : <span className="text-[8px] text-destructive">non compatible</span>}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{price(i.usd, i.unit)}</span>
                      </button>
                    );
                  })}
              </div>
              <p className="px-2 pt-1 text-[9px] text-muted-foreground/70">Prix de base du catalogue ; le prix réel peut varier avec la qualité ou la durée.</p>
            </>
          )}
          {error && <p className="px-2 py-1 text-[10px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
