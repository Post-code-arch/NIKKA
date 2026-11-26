"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, X } from "lucide-react";
import { IconPill } from "@/components/ui/pill";
import type { CatalogItem } from "@/app/api/models/catalog/route";
import type { ModelKind } from "@/lib/models/types";
import { api } from "@/lib/store/api";
import { reloadModels, useModels } from "@/lib/store/models";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<ModelKind, string> = {
  t2i: "texte → image",
  i2i: "édition d'image",
  t2v: "texte → vidéo",
  i2v: "image → vidéo",
  llm: "LLM",
};

function price(usd: number | null | undefined, unit: string | null | undefined) {
  if (usd === null || usd === undefined) return "prix ?";
  const v = usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2);
  return `$${v}${unit ? ` / ${unit === "second" ? "s" : unit}` : ""}`;
}

/**
 * Model selector of a node: models already enabled, plus a search in the
 * Atlas catalog. Adding one builds its adapter from its published schema.
 */
export function ModelPicker({ kind, value, onChange }: { kind: ModelKind; value?: string; onChange: (id: string) => void }) {
  const data = useModels();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const enabled =
    kind === "llm"
      ? (data?.llms ?? []).map((m) => ({ id: m.id, label: m.label, price: data?.mock ? "gratuit" : `$${m.inputUsdPerM} / $${m.outputUsdPerM} par M` }))
      : (data?.models ?? [])
          .filter((m) => m.kind === kind)
          .map((m) => ({ id: m.id, label: m.label, price: m.mock ? "gratuit (mock)" : price(m.pricing.usd, m.pricing.unit) }));
  const current = enabled.find((m) => m.id === value) ?? enabled[0];

  useEffect(() => {
    if (!open || data?.mock !== false) return;
    let stale = false;
    const t = setTimeout(() => {
      void api<{ items: CatalogItem[] }>(`/api/models/catalog?kind=${kind}&q=${encodeURIComponent(q)}`)
        .then((r) => !stale && setItems(r.items))
        .catch((e: Error) => !stale && setError(e.message));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [open, q, kind, data?.mock]);

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
            Modèle · {KIND_LABEL[kind]}
            <IconPill aria-label="Fermer" className="size-5 bg-transparent" onClick={() => setOpen(false)}>
              <X />
            </IconPill>
          </div>
          {enabled.length > 0 && <div className="px-2 pt-1 text-[9px] tracking-wide text-muted-foreground/70 uppercase">Activés</div>}
          {enabled.map((m) => (
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
              <span className="min-w-0 flex-1 truncate text-[11px]">{m.label}</span>
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
                  ?.filter((i) => !i.enabled)
                  .map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      disabled={!!busy}
                      onClick={() => void add(i.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                      title={`${i.id} — ajouter (son schéma est lu pour configurer l'appel)`}
                    >
                      {busy === i.id ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Plus className="size-3 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px]">{i.label}</span>
                        <span className="block truncate text-[9px] text-muted-foreground">{i.id}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{price(i.usd, i.unit)}</span>
                    </button>
                  ))}
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
