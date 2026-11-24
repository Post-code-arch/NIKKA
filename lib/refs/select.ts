import type { ReferenceTag, RefView } from "@/db/schema";
import type { CameraAttrs } from "@/lib/camera/types";

/**
 * Automatic choice of reference images for a shot (PRD §7).
 *
 * Multi-reference models accept a limited number of images, so the views to
 * send depend on the shot scale. Slots go to characters first, then the key
 * object, location, look and free references; the look never takes more
 * than one slot. Within one tag, refs share slots round-robin so two
 * characters in a close-up both get their face before anyone gets a second
 * view.
 */

export interface SelectableRef {
  id: string;
  name: string;
  tag: ReferenceTag;
  /** Views of the variant used for this shot. */
  views: { assetId: string; view: RefView }[];
}

export interface PickedView {
  refId: string;
  refName: string;
  tag: ReferenceTag;
  assetId: string;
  view: RefView;
  /** Why it was chosen, in French for the UI. */
  reason: string;
}

export interface Selection {
  picked: PickedView[];
  /** Views that were wanted but did not fit in the slot budget. */
  dropped: PickedView[];
  scaleGroup: ScaleGroup;
}

export type ScaleGroup = "close" | "mid" | "wide" | "establishing" | "insert";

/**
 * Shot scales grouped as in the PRD table:
 * très gros plan / gros plan · plan rapproché / américain · plan moyen / large ·
 * plan d'ensemble · insert.
 */
export function scaleGroup(scale: CameraAttrs["scale"]): ScaleGroup {
  switch (scale) {
    case "extreme_close":
    case "close":
      return "close";
    case "medium_close":
    case "cowboy":
    case "medium":
      return "mid";
    case "full":
    case "wide":
      return "wide";
    case "extreme_wide":
      return "establishing";
    case "insert":
      return "insert";
  }
}

interface TagRule {
  /** Preferred views, in order. */
  prefer: RefView[];
  /** How many images this ref may take. 0 = only if slots are left at the end. */
  max: number;
}

const ANY_CHARACTER: RefView[] = ["face_34", "face_front", "full_body", "profile", "expression", "untagged"];
const ANY_LOCATION: RefView[] = ["establishing", "angle_a", "angle_b", "detail", "untagged"];

const RULES: Record<ScaleGroup, Partial<Record<ReferenceTag, TagRule>>> = {
  close: {
    character: { prefer: ["face_front", "face_34", "expression"], max: 3 },
    object: { prefer: ["detail"], max: 1 },
    location: { prefer: ["establishing"], max: 0 }, // « lieu minimal ou absent »
  },
  mid: {
    character: { prefer: ["face_34", "full_body"], max: 2 },
    object: { prefer: ["detail"], max: 1 },
    location: { prefer: ["establishing", "angle_a", "angle_b"], max: 1 },
  },
  wide: {
    character: { prefer: ["full_body"], max: 1 },
    object: { prefer: ["detail"], max: 1 },
    location: { prefer: ["establishing", "angle_a", "angle_b"], max: 2 },
  },
  establishing: {
    location: { prefer: ["establishing", "angle_a", "angle_b"], max: 3 },
    character: { prefer: ["full_body"], max: 1 },
    object: { prefer: ["detail"], max: 0 },
  },
  insert: {
    object: { prefer: ["detail"], max: 3 },
    character: { prefer: ["face_34", "face_front"], max: 0 },
    location: { prefer: ["establishing"], max: 0 },
  },
};

/** Shared by every scale. */
const LOOK_RULE: TagRule = { prefer: ["mood", "palette"], max: 1 };
const FREE_RULE: TagRule = { prefer: ["untagged"], max: 1 };

/** Slot priority (PRD): characters > key object > location > look > free. */
const TAG_PRIORITY: ReferenceTag[] = ["character", "object", "location", "look", "composition", "free"];

const FALLBACK: Record<ReferenceTag, RefView[]> = {
  character: ANY_CHARACTER,
  location: ANY_LOCATION,
  object: ["detail", "untagged"],
  look: ["mood", "palette", "untagged"],
  composition: ["untagged"],
  free: ["untagged"],
};

/** Angled shots favour the closest tagged angle: 3/4 before front for characters. */
function adjustForAngle(prefer: RefView[], tag: ReferenceTag, angle: CameraAttrs["angle"]): RefView[] {
  if (tag !== "character" || angle === "eye_level") return prefer;
  const i = prefer.indexOf("face_34");
  const j = prefer.indexOf("face_front");
  if (i > j && j >= 0) {
    const copy = [...prefer];
    copy[j] = "face_34";
    copy[i] = "face_front";
    return copy;
  }
  return prefer;
}

/** Ordered list of distinct images a ref would like to send for this shot. */
function wishes(ref: SelectableRef, rule: TagRule, group: ScaleGroup, angle: CameraAttrs["angle"]): PickedView[] {
  const prefer = adjustForAngle(rule.prefer, ref.tag, angle);
  const out: PickedView[] = [];
  const used = new Set<string>();
  const take = (v: { assetId: string; view: RefView }, reason: string) => {
    if (used.has(v.assetId)) return;
    used.add(v.assetId);
    out.push({ refId: ref.id, refName: ref.name, tag: ref.tag, assetId: v.assetId, view: v.view, reason });
  };
  for (const view of prefer) {
    for (const v of ref.views.filter((x) => x.view === view)) take(v, `vue préférée pour ${GROUP_LABEL[group]}`);
  }
  // Fallback: nothing preferred is tagged, send the closest other view.
  if (out.length === 0) {
    for (const view of FALLBACK[ref.tag]) {
      const v = ref.views.find((x) => x.view === view);
      if (v) {
        take(v, "vue de repli (aucune vue préférée disponible)");
        break;
      }
    }
  }
  return out;
}

export const GROUP_LABEL: Record<ScaleGroup, string> = {
  close: "un gros plan",
  mid: "un plan rapproché",
  wide: "un plan large",
  establishing: "un plan d'ensemble",
  insert: "un insert",
};

export function selectReferenceViews(
  refs: SelectableRef[],
  camera: Pick<CameraAttrs, "scale" | "angle">,
  maxSlots: number,
): Selection {
  const group = scaleGroup(camera.scale);
  const queues = new Map<string, { ref: SelectableRef; items: PickedView[]; max: number }>();
  const optional: PickedView[] = [];

  for (const ref of refs) {
    const rule =
      ref.tag === "look"
        ? LOOK_RULE
        : ref.tag === "free" || ref.tag === "composition"
          ? FREE_RULE
          : RULES[group][ref.tag] ?? { prefer: FALLBACK[ref.tag], max: 1 };
    const items = wishes(ref, rule, group, camera.angle);
    if (rule.max === 0) {
      // Only if room is left once every wanted view is placed.
      if (items[0]) optional.push({ ...items[0], reason: `facultatif pour ${GROUP_LABEL[group]}` });
      continue;
    }
    queues.set(ref.id, { ref, items: items.slice(0, rule.max), max: rule.max });
  }

  const picked: PickedView[] = [];
  const dropped: PickedView[] = [];
  let lookUsed = false;
  const place = (v: PickedView) => {
    if (v.tag === "look") {
      if (lookUsed) return dropped.push({ ...v, reason: "le look prend au plus 1 place" });
      lookUsed = true;
    }
    if (picked.length < maxSlots) picked.push(v);
    else dropped.push({ ...v, reason: "plus de place (priorité : personnages > objet > lieu > look > libre)" });
  };

  for (const tag of TAG_PRIORITY) {
    const tagQueues = [...queues.values()].filter((q) => q.ref.tag === tag);
    // Round-robin across refs of the same tag.
    for (let round = 0; tagQueues.some((q) => q.items.length > round); round++) {
      for (const q of tagQueues) if (q.items[round]) place(q.items[round]);
    }
  }
  for (const v of optional) {
    if (picked.length < maxSlots && !(v.tag === "look" && lookUsed)) picked.push(v);
    else dropped.push({ ...v, reason: "facultatif, pas de place" });
  }
  return { picked, dropped, scaleGroup: group };
}
