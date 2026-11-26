import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import { GenerationError } from "@/lib/generation/service";
import { storeAsset } from "@/lib/media/store";

/**
 * Project export / import: one .nikka.zip holding project.json (every row of
 * the project) and assets/ (the media files). Import creates a NEW project:
 * every id is renewed, media already present (same sha256) are reused.
 * Generation jobs are not exported; a generation still running at export
 * time is imported as failed (it cannot be followed any more).
 */

const FORMAT = "nikka-project";
const VERSION = 1;

type Row = Record<string, unknown>;

const ManifestSchema = z.looseObject({
  format: z.literal(FORMAT),
  version: z.number().int(),
  exportedAt: z.number(),
  project: z.looseObject({ id: z.string(), name: z.string() }),
  sequences: z.array(z.looseObject({ id: z.string() })),
  shots: z.array(z.looseObject({ id: z.string() })),
  takes: z.array(z.looseObject({ id: z.string() })),
  references: z.array(z.looseObject({ id: z.string() })),
  referenceVariants: z.array(z.looseObject({ id: z.string() })),
  refGenerations: z.array(z.looseObject({ id: z.string() })),
  nodeRuns: z.array(z.looseObject({ id: z.string() })),
  assets: z.array(z.looseObject({ id: z.string(), sha256: z.string(), kind: z.enum(["image", "video"]), file: z.string() })),
});

const EXT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

// --- export ------------------------------------------------------------------------

/** Every asset id a project uses (takes, reference views, canvas, results). */
interface ProjectRows {
  project: Row;
  takes: Row[];
  refGenerations: Row[];
  nodeRuns: Row[];
  referenceVariants: Row[];
}

function collectAssetIds(m: ProjectRows): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => typeof v === "string" && v && ids.add(v);
  m.takes.forEach((t) => add(t.assetId));
  m.refGenerations.forEach((g) => (add(g.assetId), add(g.sourceAssetId)));
  m.nodeRuns.forEach((r) => add(r.assetId));
  m.referenceVariants.forEach((v) => ((v.views as { assetId: string }[]) ?? []).forEach((x) => add(x.assetId)));
  const canvas = (m.project.canvas ?? {}) as { nodes?: { data?: { assetId?: string } }[] };
  canvas.nodes?.forEach((n) => add(n.data?.assetId));
  return [...ids];
}

export function exportProject(projectId: string): { fileName: string; data: Uint8Array } {
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new GenerationError("Projet introuvable", 404);
  const sequences = db.select().from(schema.sequences).where(eq(schema.sequences.projectId, projectId)).all();
  const shots = sequences.length ? db.select().from(schema.shots).where(inArray(schema.shots.sequenceId, sequences.map((s) => s.id))).all() : [];
  const takes = shots.length ? db.select().from(schema.takes).where(inArray(schema.takes.shotId, shots.map((s) => s.id))).all() : [];
  const references = db.select().from(schema.references).where(eq(schema.references.projectId, projectId)).all();
  const refIds = references.map((r) => r.id);
  const referenceVariants = refIds.length ? db.select().from(schema.referenceVariants).where(inArray(schema.referenceVariants.referenceId, refIds)).all() : [];
  const refGenerations = refIds.length ? db.select().from(schema.refGenerations).where(inArray(schema.refGenerations.referenceId, refIds)).all() : [];
  const nodeRuns = db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.projectId, projectId)).all();

  const rows = { project, sequences, shots, takes, references, referenceVariants, refGenerations, nodeRuns };
  const assetIds = collectAssetIds(rows as unknown as ProjectRows);
  const assets: Asset[] = assetIds.length ? db.select().from(schema.assets).where(inArray(schema.assets.id, assetIds)).all() : [];

  const files: Record<string, Uint8Array> = {};
  const assetRows = assets.flatMap((a) => {
    const name = `assets/${path.basename(a.path)}`;
    try {
      files[name] = readFileSync(path.resolve(/*turbopackIgnore: true*/ a.path));
    } catch {
      return []; // file missing on disk: the media is skipped, not the project
    }
    return [{ ...a, file: name }];
  });
  const manifest = { format: FORMAT, version: VERSION, exportedAt: Date.now(), ...rows, assets: assetRows };
  // Media are already compressed: store them as is (level 0), compress the JSON.
  const zipped = zipSync({
    "project.json": [strToU8(JSON.stringify(manifest)), { level: 9 }],
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }] as [Uint8Array, { level: 0 }]])),
  });
  const safe = project.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-") || "projet";
  return { fileName: `${safe}.nikka.zip`, data: zipped };
}

// --- import ------------------------------------------------------------------------

export async function importProject(zip: Uint8Array): Promise<{ id: string; name: string }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new GenerationError("Fichier illisible : ce n'est pas un export NIKKA (.nikka.zip)", 400);
  }
  if (!entries["project.json"]) throw new GenerationError("Fichier invalide : project.json manquant", 400);
  const parsed = ManifestSchema.safeParse(JSON.parse(strFromU8(entries["project.json"])));
  if (!parsed.success) throw new GenerationError("Export NIKKA invalide ou d'une version inconnue", 400);
  const m = parsed.data;
  if (m.version > VERSION) throw new GenerationError("Cet export vient d'une version plus récente de NIKKA : mets NIKKA à jour", 400);

  const db = getDb();

  // Media first (outside the transaction: files on disk). Same content → same asset.
  const assetMap = new Map<string, string>();
  for (const a of m.assets) {
    const existing = db.select().from(schema.assets).where(eq(schema.assets.sha256, a.sha256)).get();
    if (existing) {
      assetMap.set(a.id, existing.id);
      continue;
    }
    const bytes = entries[a.file];
    if (!bytes) continue;
    const ext = path.extname(a.file).toLowerCase();
    const stored = await storeAsset(Buffer.from(bytes), EXT_TYPE[ext] ?? null, path.basename(a.file));
    assetMap.set(a.id, stored.id);
  }

  // Every old id gets a new one; unknown ids (dangling) become null.
  const ids = new Map<string, string>();
  const fresh = (old: unknown) => {
    if (typeof old !== "string" || !old) return null;
    if (!ids.has(old)) ids.set(old, randomUUID());
    return ids.get(old)!;
  };
  const known = new Set([m.project, ...m.sequences, ...m.shots, ...m.takes, ...m.references, ...m.referenceVariants, ...m.refGenerations, ...m.nodeRuns].map((r) => r.id));
  const ref = (old: unknown) => (typeof old === "string" && known.has(old) ? fresh(old) : null);
  const asset = (old: unknown) => (typeof old === "string" ? (assetMap.get(old) ?? null) : null);
  const finished = (r: Row) =>
    r.status === "queued" || r.status === "processing"
      ? { status: "failed", error: "Génération en cours au moment de l'export : relance-la" }
      : {};

  const names = new Set(db.select({ name: schema.projects.name }).from(schema.projects).all().map((p) => p.name));
  const name = names.has(m.project.name) ? `${m.project.name} (importé)` : m.project.name;

  const canvas = structuredClone((m.project.canvas ?? { nodes: [], edges: [] }) as { nodes: { data: Row }[]; edges: unknown[] });
  for (const n of canvas.nodes ?? []) {
    if (n.data?.assetId) n.data.assetId = asset(n.data.assetId) ?? undefined;
    if (n.data?.referenceId) n.data.referenceId = ref(n.data.referenceId) ?? undefined;
    if (n.data?.selectedRunId) n.data.selectedRunId = ref(n.data.selectedRunId) ?? undefined;
  }
  const digest = structuredClone((m.project.digest ?? {}) as { applied?: { referenceIds?: string[]; sequenceIds?: string[] } });
  if (digest.applied) {
    digest.applied.referenceIds = (digest.applied.referenceIds ?? []).map(ref).filter((x): x is string => !!x);
    digest.applied.sequenceIds = (digest.applied.sequenceIds ?? []).map(ref).filter((x): x is string => !!x);
  }

  const projectId = fresh(m.project.id)!;
  db.transaction((tx) => {
    const p = m.project as Row;
    tx.insert(schema.projects)
      .values({ ...(p as typeof schema.projects.$inferInsert), id: projectId, name, canvas, digest, updatedAt: Date.now() })
      .run();
    for (const s of m.sequences as Row[]) {
      tx.insert(schema.sequences)
        .values({ ...(s as typeof schema.sequences.$inferInsert), id: fresh(s.id)!, projectId, locationRefId: ref(s.locationRefId) })
        .run();
    }
    // References before shots? Shots carry refIds (plain json) and references may point to a shot: insert shots first.
    for (const s of m.shots as Row[]) {
      const framing = s.framing as Record<string, string> | null;
      tx.insert(schema.shots)
        .values({
          ...(s as typeof schema.shots.$inferInsert),
          id: fresh(s.id)!,
          sequenceId: ref(s.sequenceId)!,
          refIds: ((s.refIds as string[]) ?? []).map(ref).filter((x): x is string => !!x),
          framing: framing ? (Object.fromEntries(Object.entries(framing).flatMap(([k, v]) => (ref(k) ? [[ref(k)!, v]] : []))) as typeof schema.shots.$inferInsert.framing) : null,
          selectedTakeId: ref(s.selectedTakeId),
          graph: { nodes: [], edges: [] },
        })
        .run();
    }
    for (const r of m.references as Row[]) {
      tx.insert(schema.references)
        .values({ ...(r as typeof schema.references.$inferInsert), id: fresh(r.id)!, projectId, shotId: ref(r.shotId) })
        .run();
    }
    for (const v of m.referenceVariants as Row[]) {
      const views = ((v.views as { assetId: string; view: string }[]) ?? []).flatMap((x) => (asset(x.assetId) ? [{ ...x, assetId: asset(x.assetId)! }] : []));
      tx.insert(schema.referenceVariants)
        .values({ ...(v as typeof schema.referenceVariants.$inferInsert), id: fresh(v.id)!, referenceId: ref(v.referenceId)!, views: views as typeof schema.referenceVariants.$inferInsert.views })
        .run();
    }
    for (const t of m.takes as Row[]) {
      tx.insert(schema.takes)
        .values({
          ...(t as typeof schema.takes.$inferInsert),
          id: fresh(t.id)!,
          shotId: ref(t.shotId)!,
          assetId: asset(t.assetId),
          parentTakeId: ref(t.parentTakeId),
          ...finished(t),
        } as typeof schema.takes.$inferInsert)
        .run();
    }
    for (const g of m.refGenerations as Row[]) {
      tx.insert(schema.refGenerations)
        .values({
          ...(g as typeof schema.refGenerations.$inferInsert),
          id: fresh(g.id)!,
          referenceId: ref(g.referenceId)!,
          variantId: ref(g.variantId)!,
          assetId: asset(g.assetId),
          sourceAssetId: asset(g.sourceAssetId),
          ...finished(g),
        } as typeof schema.refGenerations.$inferInsert)
        .run();
    }
    for (const r of m.nodeRuns as Row[]) {
      tx.insert(schema.nodeRuns)
        .values({
          ...(r as typeof schema.nodeRuns.$inferInsert),
          id: fresh(r.id)!,
          projectId,
          shotId: ref(r.shotId),
          assetId: asset(r.assetId),
          sentTakeId: ref(r.sentTakeId),
          ...finished(r),
        } as typeof schema.nodeRuns.$inferInsert)
        .run();
    }
  });
  return { id: projectId, name };
}
