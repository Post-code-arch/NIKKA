"use client";

import { useState } from "react";
import { Ban, ChevronLeft, Clapperboard, Film, Image as ImageIcon, LayoutPanelLeft, Library, Search, Sparkles, Type, Video, Wand2, type LucideIcon } from "lucide-react";
import { IconPill } from "@/components/ui/pill";
import { NODE_ORDER, NODE_SPECS, PORT_COLOR, type NodeType } from "@/lib/graph/types";
import { cn } from "@/lib/utils";
import { GROUP } from "./graph-nodes";

/** Drag payload of a node dragged from the library onto the canvas. */
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
};

/** Colour of the node's main output, so the library reads like the ports. */
function accent(type: NodeType) {
  const out = NODE_SPECS[type].outputs[0];
  return out ? PORT_COLOR[out.type] : "var(--muted-foreground)";
}

/**
 * Left panel listing every node: click to add it in the middle of the view,
 * or drag it to the exact spot on the canvas.
 */
export function NodeLibrary({ open, onToggle, onAdd }: { open: boolean; onToggle: () => void; onAdd: (type: NodeType) => void }) {
  const [q, setQ] = useState("");
  if (!open) {
    return (
      <IconPill aria-label="Afficher les nodes" title="Afficher les nodes" className="pointer-events-auto absolute top-16 left-4 z-10" onClick={onToggle}>
        <LayoutPanelLeft />
      </IconPill>
    );
  }
  const query = q.trim().toLowerCase();
  const types = NODE_ORDER.filter((t) => !query || `${NODE_SPECS[t].label} ${NODE_SPECS[t].description}`.toLowerCase().includes(query));
  return (
    <aside className="island absolute top-16 bottom-4 left-4 z-10 flex w-60 flex-col p-1.5" aria-label="Nodes">
      <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1">
        <span className="text-xs">Nodes</span>
        <IconPill aria-label="Masquer les nodes" className="size-6 bg-transparent" onClick={onToggle}>
          <ChevronLeft />
        </IconPill>
      </div>
      <div className="mb-1 flex items-center gap-1.5 rounded-md bg-surface px-2">
        <Search className="size-3 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher un node…"
          className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                title="Clic : ajouter au centre · glisser : déposer où tu veux"
                className={cn("flex w-full cursor-grab items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 active:cursor-grabbing")}
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-surface" style={{ color: accent(type) }}>
                  <Icon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs">{NODE_SPECS[type].label}</span>
                  <span className="block text-[10px] leading-snug text-muted-foreground">{NODE_SPECS[type].description}</span>
                </span>
              </button>
            </div>
          );
        })}
        {types.length === 0 && <p className="px-2 py-2 text-[10px] text-muted-foreground">Aucun node ne correspond.</p>}
      </div>
    </aside>
  );
}
