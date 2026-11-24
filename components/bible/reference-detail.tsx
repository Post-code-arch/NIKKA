"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import { IconPill, Pill } from "@/components/ui/pill";
import type { Asset, RefGeneration, Reference, ReferenceVariant, RefView } from "@/db/schema";
import { TAG_COLOR_VAR, TAG_LABEL, VIEW_LABEL, VIEWS_BY_TAG } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { cn } from "@/lib/utils";
import { PackAssistant } from "./pack-assistant";
import { Thumb } from "./view-thumb";

export type ReferenceDetailData = Reference & {
  variants: ReferenceVariant[];
  generations: RefGeneration[];
  assets: Record<string, Pick<Asset, "id" | "kind" | "width" | "height">>;
};

/** Reference sheet: descriptor, variants, tagged views, pack assistant. */
export function ReferenceDetail({
  referenceId,
  onClose,
  onChanged,
}: {
  referenceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<ReferenceDetailData | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [descriptor, setDescriptor] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPack, setShowPack] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await api<ReferenceDetailData>(`/api/references/${referenceId}`);
    setData(d);
    return d;
  }, [referenceId]);

  useEffect(() => {
    void api<ReferenceDetailData>(`/api/references/${referenceId}`).then((d) => {
      setData(d);
      setName(d.name);
      setDescriptor(d.descriptor);
      setVariantId(d.variants[0]?.id ?? null);
    });
  }, [referenceId]);

  const pending = data?.generations.some((g) => g.status === "queued" || g.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void load(), 1200);
    return () => clearInterval(t);
  }, [pending, load]);

  if (!data) {
    return (
      <Modal onClose={onClose}>
        <div className="grid h-40 place-items-center text-xs text-muted-foreground">Chargement…</div>
      </Modal>
    );
  }

  const variant = data.variants.find((v) => v.id === variantId) ?? data.variants[0];
  const viewOptions = VIEWS_BY_TAG[data.tag];

  const patchRef = async (body: Record<string, unknown>) => {
    await api(`/api/references/${data.id}`, { method: "PATCH", body });
    await load();
    onChanged();
  };
  const setViews = async (views: ReferenceVariant["views"]) => {
    if (!variant) return;
    await api(`/api/variants/${variant.id}`, { method: "PATCH", body: { views } });
    await load();
    onChanged();
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length || !variant) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      [...files].forEach((f) => form.append("files", f));
      const res = await fetch("/api/assets", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Import impossible");
      const added = (body as { id: string; kind: string }[])
        .filter((a) => a.kind === "image")
        .map((a) => ({ assetId: a.id, view: "untagged" as RefView }));
      await setViews([...variant.views, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addVariant = async () => {
    const label = prompt("Nom de la variante (ex. « Costume de nuit », « Blessé »)");
    if (!label?.trim()) return;
    const v = await api<ReferenceVariant>(`/api/references/${data.id}/variants`, { body: { name: label.trim() } });
    await load();
    setVariantId(v.id);
    onChanged();
  };

  const deleteRef = async () => {
    if (!confirm(`Supprimer « ${data.name} » de la bible ?`)) return;
    await api(`/api/references/${data.id}`, { method: "DELETE" });
    onClose();
  };

  return (
    <Modal onClose={onClose} wide>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span
            className="mb-1 inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-[10px]"
            style={{ color: TAG_COLOR_VAR[data.tag] }}
          >
            <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[data.tag] }} />
            {TAG_LABEL[data.tag]}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== data.name && void patchRef({ name: name.trim() })}
            className="block w-full rounded-md bg-transparent px-1 text-base font-medium outline-none focus:bg-surface-2"
          />
        </div>
        <div className="flex gap-1">
          <IconPill aria-label="Supprimer la référence" className="bg-transparent" onClick={() => void deleteRef()}>
            <Trash2 />
          </IconPill>
          <IconPill aria-label="Fermer" className="bg-transparent" onClick={onClose}>
            <X />
          </IconPill>
        </div>
      </div>

      <label className="mb-1 block text-[11px] text-muted-foreground">
        Descripteur · injecté tel quel dans les prompts, jamais réécrit par l&apos;IA
      </label>
      <textarea
        value={descriptor}
        onChange={(e) => setDescriptor(e.target.value)}
        onBlur={() => descriptor !== data.descriptor && void patchRef({ descriptor })}
        rows={3}
        placeholder={
          data.tag === "character"
            ? "Femme de 30 ans, cheveux noirs courts, manteau rouge, cicatrice sur le sourcil gauche…"
            : "Description visuelle précise et stable…"
        }
        className="mb-4 w-full resize-none rounded-md bg-surface-2 p-2 text-xs leading-relaxed outline-none placeholder:text-muted-foreground/50"
      />

      <div className="mb-3 flex items-center gap-1 overflow-x-auto">
        {data.variants.map((v) => (
          <Pill key={v.id} active={v.id === variant?.id} onClick={() => setVariantId(v.id)}>
            {v.name} <span className="font-mono text-muted-foreground">{v.views.length}</span>
          </Pill>
        ))}
        <Pill className="bg-transparent" onClick={() => void addVariant()}>
          <Plus /> Variante
        </Pill>
      </div>

      {variant && (
        <>
          <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {variant.views.map((v, i) => (
              <div key={`${v.assetId}-${i}`} className="rounded-[10px] bg-surface-2 p-1.5">
                <Thumb assetId={v.assetId} className="aspect-square w-full" />
                <div className="mt-1.5 flex items-center gap-1">
                  <select
                    value={v.view}
                    onChange={(e) =>
                      void setViews(variant.views.map((x, j) => (j === i ? { ...x, view: e.target.value as RefView } : x)))
                    }
                    className={cn(
                      "h-7 min-w-0 flex-1 rounded-md bg-surface px-1.5 text-[11px] outline-none",
                      v.view === "untagged" && "text-muted-foreground",
                    )}
                  >
                    {[...new Set([...viewOptions, v.view])].map((o) => (
                      <option key={o} value={o}>
                        {VIEW_LABEL[o]}
                      </option>
                    ))}
                  </select>
                  <IconPill
                    aria-label="Retirer cette vue"
                    className="size-7 bg-transparent"
                    onClick={() => void setViews(variant.views.filter((_, j) => j !== i))}
                  >
                    <X />
                  </IconPill>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="grid aspect-square place-items-center rounded-[10px] border border-dashed text-muted-foreground hover:bg-surface-2"
            >
              <span className="flex flex-col items-center gap-1 text-[11px]">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                Ajouter des images
              </span>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
          {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

          {!showPack ? (
            <Pill onClick={() => setShowPack(true)}>
              <Sparkles /> Assistant pack de référence
            </Pill>
          ) : (
            <PackAssistant
              reference={data}
              variant={variant}
              onLaunched={() => void load()}
              onValidated={async () => {
                await load();
                onChanged();
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={cn("island max-h-[88vh] overflow-y-auto p-4", wide ? "w-[min(760px,calc(100vw-2rem))]" : "w-[420px]")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
