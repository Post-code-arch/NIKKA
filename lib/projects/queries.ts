import { asc, desc, eq, inArray, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Asset, Project, Reference, ReferenceVariant, Sequence, Shot, Take } from "@/db/schema";

export type ShotWithTakes = Shot & { takes: Take[] };
export type SequenceTree = Sequence & { shots: ShotWithTakes[] };
export type ProjectTree = Project & {
  sequences: SequenceTree[];
  references: (Reference & { variants: ReferenceVariant[] })[];
  assets: Record<string, Pick<Asset, "id" | "kind" | "width" | "height" | "durationSec">>;
  cost: { estimatedUsd: number; actualUsd: number };
};

export function getProjectTree(projectId: string): ProjectTree | null {
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return null;
  const seqs = db
    .select()
    .from(schema.sequences)
    .where(eq(schema.sequences.projectId, projectId))
    .orderBy(asc(schema.sequences.order))
    .all();
  const seqIds = seqs.map((s) => s.id);
  const shotList = seqIds.length
    ? db.select().from(schema.shots).where(inArray(schema.shots.sequenceId, seqIds)).orderBy(asc(schema.shots.order)).all()
    : [];
  const shotIds = shotList.map((s) => s.id);
  const takeList = shotIds.length
    ? db.select().from(schema.takes).where(inArray(schema.takes.shotId, shotIds)).orderBy(desc(schema.takes.createdAt)).all()
    : [];
  const refs = db.select().from(schema.references).where(eq(schema.references.projectId, projectId)).all();
  const variants = refs.length
    ? db.select().from(schema.referenceVariants).where(inArray(schema.referenceVariants.referenceId, refs.map((r) => r.id))).all()
    : [];

  const assetIds = new Set<string>();
  takeList.forEach((t) => t.assetId && assetIds.add(t.assetId));
  variants.forEach((v) => v.views.forEach((w) => assetIds.add(w.assetId)));
  const assetRows = assetIds.size
    ? db
        .select({
          id: schema.assets.id,
          kind: schema.assets.kind,
          width: schema.assets.width,
          height: schema.assets.height,
          durationSec: schema.assets.durationSec,
        })
        .from(schema.assets)
        .where(inArray(schema.assets.id, [...assetIds]))
        .all()
    : [];

  const cost = takeList.reduce(
    (acc, t) => ({
      estimatedUsd: acc.estimatedUsd + t.costEstimatedUsd,
      actualUsd: acc.actualUsd + (t.costActualUsd ?? 0),
    }),
    { estimatedUsd: 0, actualUsd: 0 },
  );

  return {
    ...project,
    sequences: seqs.map((s) => ({
      ...s,
      shots: shotList
        .filter((sh) => sh.sequenceId === s.id)
        .map((sh) => ({ ...sh, takes: takeList.filter((t) => t.shotId === sh.id) })),
    })),
    references: refs.map((r) => ({ ...r, variants: variants.filter((v) => v.referenceId === r.id) })),
    assets: Object.fromEntries(assetRows.map((a) => [a.id, a])),
    cost,
  };
}

export function nextSequenceOrder(projectId: string): number {
  const r = getDb()
    .select({ m: max(schema.sequences.order) })
    .from(schema.sequences)
    .where(eq(schema.sequences.projectId, projectId))
    .get();
  return (r?.m ?? -1) + 1;
}

export function nextShotOrder(sequenceId: string): number {
  const r = getDb()
    .select({ m: max(schema.shots.order) })
    .from(schema.shots)
    .where(eq(schema.shots.sequenceId, sequenceId))
    .get();
  return (r?.m ?? -1) + 1;
}
