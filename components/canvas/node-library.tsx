"use client";

import { useEffect, useState } from "react";
import {
  Ban,
  ChevronLeft,
  Clapperboard,
  Film,
  Image as ImageIcon,
  LayoutPanelLeft,
  Library,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Type,
  Video,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { CatalogItem, ModelCaps } from "@/app/api/models/catalog/route";
import { IconPill } from "@/components/ui/pill";
import { NODE_ORDER, NODE_SPECS, PORT_COLOR, type NodeType } from "@/lib/graph/types";
import type { ModelKind } from "@/lib/models/types";
import { api } from "@/lib/store/api";
import { reloadModels, useModels } from "@/lib/store/models";
import { cn } from "@/lib/utils";
import { GROUP } from "./graph-nodes";
import { Badges, KIND_LABEL, price } from "./model-picker";
import { NODE_SHORTCUTS } from "./shortcuts";

/** Drag payload: "nodeType", or "nodeType|modelId" for a model dragged from the Models tab. */
export const NODE_MIME = "application/nikka-node";

const ICON: Record<NodeType, LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Film,
  reference: Library,
  negative: Ban,
  promptEnhancer: Wand2,
  textToImage: Sparkles,
  textToVideo: Clapperboard,
  imageToVideo: Video,
  videoToVideo: Film,
  referenceToVideo: Library,
};

/** The node a model of each kind goes into. */
export const NODE_FOR_KIND: Record<ModelKind, NodeType> = {
  t2i: "textToImage",
  i2i: "textToImage",
  t2v: "textToVideo",
  i2v: "imageToVideo",
  v2v: "videoToVideo",
  r2v: "referenceToVideo",
  llm: "promptEnhancer",
};

const KIND_ORDER: ModelKind[] = ["t2i", "i2i", "t2v", "i2v", "r2v", "v2v", "llm"];

/** Colour of the node's main output, so the library reads like the ports. */
function accent(type: NodeType) {
  const out = NODE_SPECS[type].outputs[0];
  return out ? PORT_COLOR[out.type] : "var(--muted-foreground)";
}

type OnAdd = (type: NodeType, modelId?: string) => void;

/**
 * Left panel. "Nodes": every node, click to add it in the middle of the view
 * or drag it to a spot. "Modèles": the models, click or drag one to get the
 * right node with that model already chosen; search the Atlas catalog.
 */
export function NodeLibrary({ open, onToggle, onAdd }: { open: boolean; onToggle: () => void; onAdd: OnAdd }) {
  const [tab, setTab] = useState<"nodes" | "models">("nodes");
  const [q, setQ] = useState("");
  if (!open) {
    return (
      <IconPill aria-label="Afficher les nodes" title="Afficher les nodes et les modèles" className="pointer-events-auto absolute top-16 left-4 z-10" onClick={onToggle}>
        <LayoutPanelLeft />
      </IconPill>
    );
  }
  return (
    <aside className="island absolute top-16 bottom-4 left-4 z-10 flex w-64 flex-col p-1.5" aria-label="Nodes et modèles">
      <div className="flex items-center gap-1 pb-1">
        {(["nodes", "models"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("h-7 flex-1 rounded-md text-xs", tab === t ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "nodes" ? "Nodes" : "Modèles"}
          </button>
        ))}
        <IconPill aria-label="Masquer le panneau" className="size-6 bg-transparent" onClick={onToggle}>
          <ChevronLeft />
        </IconPill>
      </div>
      <div className="mb-1 flex items-center gap-1.5 rounded-md bg-surface px-2">
        <Search className="size-3 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "nodes" ? "Chercher un node…" : "Chercher un modèle…"}
          className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === "nodes" ? <NodesTab q={q} onAdd={onAdd} /> : <ModelsTab q={q} onAdd={onAdd} />}</div>
    </aside>
  );
}

function NodesTab({ q, onAdd }: { q: string; onAdd: OnAdd }) {
  const query = q.trim().toLowerCase();
  const types = NODE_ORDER.filter((t) => !query || `${NODE_SPECS[t].label} ${NODE_SPECS[t].description}`.toLowerCase().includes(query));
  return (
    <>
      {types.map((type, i) => {
        const Icon = ICON[type];
        return (
          <div key={type}>
            {(i === 0 || GROUP[types[i - 1]] !== GROUP[type]) && (
              <div className="mt-1.5 px-2 pb-0.5 text-[9px] tracking-wide text-muted-foreground/70 uppercase">{GROUP[type]}</div>
            )}
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(NODE_MIME, type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(type)}
              title={`Clic : ajouter au centre · glisser : déposer où tu veux · touche ${NODE_SHORTCUTS[type]}`}
              className="flex w-full cursor-grab items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 active:cursor-grabbing"
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface" style={{ color: accent(type) }}>
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs">{NODE_SPECS[type].label}</span>
                <span className="block text-[10px] leading-snug text-muted-foreground">{NODE_SPECS[type].description}</span>
              </span>
              <kbd className="mt-0.5 shrink-0 rounded border px-1 font-mono text-[9px] text-muted-foreground">{NODE_SHORTCUTS[type]}</kbd>
            </button>
          </div>
        );
      })}
      {types.length === 0 && <p className="px-2 py-2 text-[10px] text-muted-foreground">Aucun node ne correspond.</p>}
    </>
  );
}

interface Row {
  id: string;
  label: string;
  kind: ModelKind;
  price: string;
  caps?: ModelCaps | null;
}

function ModelRow({ m, onAdd, action }: { m: Row; onAdd?: OnAdd; action?: React.ReactNode }) {
  const node = NODE_FOR_KIND[m.kind];
  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <button
        type="button"
        draggable={!!onAdd}
        onDragStart={(e) => {
          e.dataTransfer.setData(NODE_MIME, `${node}|${m.id}`);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => onAdd?.(node, m.id)}
        disabled={!onAdd}
        title={onAdd ? `Clic : nouveau node « ${NODE_SPECS[node].label} » avec ce modèle · glisser : le déposer où tu veux` : m.id}
        className={cn("flex min-w-0 flex-1 items-start gap-2 text-left", onAdd && "cursor-grab active:cursor-grabbing")}
      >
        <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-surface" style={{ color: accent(node) }}>
          {(() => {
            const Icon = ICON[node];
            return <Icon className="size-3" />;
          })()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px]">{m.label}</span>
          <span className="block truncate text-[9px] text-muted-foreground">{m.price}</span>
          <Badges caps={m.caps} />
        </span>
      </button>
      {action}
    </div>
  );
}

function ModelsTab({ q, onAdd }: { q: string; onAdd: OnAdd }) {
  const data = useModels();
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = q.trim().toLowerCase();

  const enabled: Row[] = [
    ...(data?.models ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      kind: m.kind,
      price: m.mock ? "gratuit (mock)" : price(m.pricing.usd, m.pricing.unit),
      caps: { refs: m.maxReferenceImages, videoRefs: m.maxReferenceVideos, negative: m.supportsNegativePrompt, startEnd: m.supportsStartEndFrames },
    })),
    ...(data?.llms ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      kind: "llm" as const,
      price: data?.mock ? "gratuit (mock)" : `$${m.inputUsdPerM} / $${m.outputUsdPerM} par M tokens`,
    })),
  ].filter((m) => !query || `${m.label} ${m.id}`.toLowerCase().includes(query));

  // The Atlas catalog (real mode), every kind NIKKA can drive.
  useEffect(() => {
    if (data?.mock !== false) return;
    let stale = false;
    const t = setTimeout(() => {
      void api<{ items: CatalogItem[] }>(`/api/models/catalog?kind=${KIND_ORDER.join(",")}&q=${encodeURIComponent(query)}`)
        .then((r) => !stale && setItems(r.items))
        .catch((e: Error) => !stale && setError(e.message));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query, data?.mock]);

  const enable = async (item: CatalogItem) => {
    setBusy(item.id);
    setError(null);
    try {
      await api("/api/models/enable", { body: { id: item.id } });
      await reloadModels();
      // It now shows with the enabled ones.
      setItems((list) => list?.map((x) => (x.id === item.id ? { ...x, enabled: true } : x)) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="px-2 pt-1 pb-0.5 text-[9px] tracking-wide text-muted-foreground/70 uppercase">Activés</div>
      {KIND_ORDER.map((kind) => {
        const list = enabled.filter((m) => m.kind === kind);
        if (!list.length) return null;
        return (
          <div key={kind}>
            <div className="mt-1 px-2 text-[10px] text-muted-foreground">{KIND_LABEL[kind]}</div>
            {list.map((m) => (
              <ModelRow key={m.id} m={m} onAdd={onAdd} />
            ))}
          </div>
        );
      })}
      {enabled.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Aucun modèle activé ne correspond.</p>}

      {data?.mock ? (
        <p className="mt-2 px-2 text-[10px] leading-relaxed text-muted-foreground">
          Mode mock : modèles factices, rien n&apos;est facturé. Le catalogue Atlas (et ses prix) s&apos;ouvre en mode réel.
        </p>
      ) : (
        <>
          <div className="mt-3 px-2 pb-0.5 text-[9px] tracking-wide text-muted-foreground/70 uppercase">Catalogue Atlas</div>
          {!items && !error && <Loader2 className="mx-auto my-3 size-3.5 animate-spin text-muted-foreground" />}
          {items
            ?.filter((i) => !i.enabled)
            .map((i) => {
              const usable = i.kind === "llm" || !!i.caps;
              return (
                <ModelRow
                  key={i.id}
                  m={{ id: i.id, label: i.label, kind: i.kind as ModelKind, price: usable ? price(i.usd, i.unit) : "non compatible", caps: i.caps }}
                  action={
                    <IconPill
                      aria-label={`Activer ${i.label}`}
                      title={usable ? "Activer ce modèle (son schéma est lu pour configurer l'appel)" : i.incompatible}
                      disabled={!usable || !!busy}
                      className="size-6 shrink-0"
                      onClick={() => void enable(i)}
                    >
                      {busy === i.id ? <Loader2 className="animate-spin" /> : <Plus />}
                    </IconPill>
                  }
                />
              );
            })}
          {items?.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground">Aucun modèle trouvé.</p>}
          <p className="px-2 pt-1 text-[9px] text-muted-foreground/70">Prix de base du catalogue ; le prix réel s&apos;apprend au premier appel.</p>
        </>
      )}
      {error && <p className="px-2 py-1 text-[10px] text-destructive">{error}</p>}
    </>
  );
}
