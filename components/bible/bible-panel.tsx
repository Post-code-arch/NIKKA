"use client";

import { useState } from "react";
import { ChevronLeft, FlaskConical, Library, Plus } from "lucide-react";
import { IconPill, Pill } from "@/components/ui/pill";
import type { ReferenceTag } from "@/db/schema";
import { TAG_COLOR_VAR, TAG_LABEL, TAG_ORDER } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";
import { ReferenceDetail } from "./reference-detail";
import { SelectionTester } from "./selection-tester";
import { Thumb } from "./view-thumb";

function NewReferenceForm({ projectId, onCreated }: { projectId: string; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState<ReferenceTag>("character");
  return (
    <form
      className="mb-3 space-y-2 rounded-[10px] bg-surface-2 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void api<{ id: string }>(`/api/projects/${projectId}/references`, {
          body: { name: name.trim(), tag, scope: "bible" },
        }).then((r) => onCreated(r.id));
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom (ex. Lina)"
        className="h-8 w-full rounded-md bg-surface px-2 text-xs outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex gap-1">
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value as ReferenceTag)}
          className="h-8 min-w-0 flex-1 rounded-md bg-surface px-2 text-xs outline-none"
        >
          {TAG_ORDER.map((t) => (
            <option key={t} value={t}>
              {TAG_LABEL[t]}
            </option>
          ))}
        </select>
        <Pill type="submit" disabled={!name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground">
          Créer
        </Pill>
      </div>
    </form>
  );
}

/** Left panel: the project's shared references, grouped by tag (PRD §7). */
export function BiblePanel() {
  const project = useProjectStore((s) => s.project);
  const refresh = useProjectStore((s) => s.refresh);
  const open = useUiStore((s) => s.bibleOpen);
  const setOpen = useUiStore((s) => s.setBibleOpen);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  if (!project) return null;
  const refs = project.references.filter((r) => r.scope === "bible");

  if (!open) {
    return (
      <div className="pointer-events-auto absolute top-3 left-4 z-20">
        <Pill onClick={() => setOpen(true)} className="island">
          <Library /> Bible <span className="font-mono text-muted-foreground">{refs.length}</span>
        </Pill>
      </div>
    );
  }

  return (
    <>
      <aside className="island pointer-events-auto absolute top-3 bottom-4 left-4 z-20 flex w-64 flex-col p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <Library className="size-3.5" /> Bible
          </span>
          <div className="flex gap-1">
            <IconPill aria-label="Nouvelle référence" className="size-7" onClick={() => setCreating((c) => !c)}>
              <Plus />
            </IconPill>
            <IconPill aria-label="Replier" className="size-7 bg-transparent" onClick={() => setOpen(false)}>
              <ChevronLeft />
            </IconPill>
          </div>
        </div>

        {creating && (
          <NewReferenceForm
            projectId={project.id}
            onCreated={(id) => {
              setCreating(false);
              void refresh();
              setDetailId(id);
            }}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {refs.length === 0 && !creating && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Aucune référence. Ajoute tes personnages, lieux, objets et looks avec +.
            </p>
          )}
          {TAG_ORDER.map((tag) => {
            const group = refs.filter((r) => r.tag === tag);
            if (group.length === 0) return null;
            return (
              <section key={tag} className="mb-3">
                <h3 className="mb-1 flex items-center gap-1.5 px-1 text-[10px] tracking-wide text-muted-foreground uppercase">
                  <span className="size-1.5 rounded-full" style={{ background: TAG_COLOR_VAR[tag] }} />
                  {TAG_LABEL[tag]}
                </h3>
                {group.map((r) => {
                  const views = r.variants.flatMap((v) => v.views);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setDetailId(r.id)}
                      className="mb-1 flex w-full items-center gap-2 rounded-md p-1 text-left hover:bg-surface-2"
                    >
                      {views[0] ? (
                        <Thumb assetId={views[0].assetId} className="size-9 shrink-0" />
                      ) : (
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-[11px]"
                          style={{ color: TAG_COLOR_VAR[tag] }}
                        >
                          {r.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{r.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {r.variants.length > 1 ? `${r.variants.length} variantes · ` : ""}
                          {views.length} vue{views.length > 1 ? "s" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>

        <Pill className={cn("mt-1 justify-center", refs.length === 0 && "opacity-50")} disabled={refs.length === 0} onClick={() => setTesting(true)}>
          <FlaskConical /> Tester la sélection
        </Pill>
      </aside>

      {detailId && (
        <ReferenceDetail
          referenceId={detailId}
          onClose={() => {
            setDetailId(null);
            void refresh();
          }}
          onChanged={() => void refresh()}
        />
      )}
      {testing && <SelectionTester refs={refs} onClose={() => setTesting(false)} />}
    </>
  );
}
