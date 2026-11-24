import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { CameraAttrs } from "@/lib/camera/types";
import { selectReferenceViews, type SelectableRef } from "./select";

/** Loads the chosen variants (default: first one) and runs the selection. */
export function previewSelection(
  refs: { referenceId: string; variantId?: string }[],
  camera: Pick<CameraAttrs, "scale" | "angle">,
  maxSlots: number,
) {
  const db = getDb();
  const ids = refs.map((r) => r.referenceId);
  if (ids.length === 0) return selectReferenceViews([], camera, maxSlots);
  const rows = db.select().from(schema.references).where(inArray(schema.references.id, ids)).all();
  const variants = db.select().from(schema.referenceVariants).where(inArray(schema.referenceVariants.referenceId, ids)).all();
  const selectable: SelectableRef[] = refs.flatMap((r) => {
    const ref = rows.find((x) => x.id === r.referenceId);
    if (!ref) return [];
    const own = variants.filter((v) => v.referenceId === ref.id);
    const variant = own.find((v) => v.id === r.variantId) ?? own[0];
    return [{ id: ref.id, name: ref.name, tag: ref.tag, views: variant?.views ?? [] }];
  });
  return selectReferenceViews(selectable, camera, maxSlots);
}
