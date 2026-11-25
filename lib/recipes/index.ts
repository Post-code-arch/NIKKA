import type { ReferenceTag } from "@/db/schema";
import { NODE_SPECS, type GraphEdge, type GraphNode, type GraphNodeData, type NodeType, type ShotGraphData } from "@/lib/graph/types";

/**
 * Recipes (PRD §9): predefined shot sub-graphs, shown folded as one block
 * and unfoldable to edit their internal nodes.
 */

export type RecipeId = "character" | "location" | "object" | "continuity" | "free";

export const RECIPES: Record<RecipeId, { label: string; chain: string }> = {
  character: {
    label: "Plan personnage",
    chain: "Références → Sélection des vues → Prompt → Édition multi-réf → Prise → Vidéo → Prise",
  },
  location: { label: "Plan lieu / ambiance", chain: "Références lieu + look → Prompt → Image → Prise → Vidéo → Prise" },
  object: { label: "Plan objet / produit", chain: "Référence objet + look → Prompt → Édition multi-réf → Prise → Vidéo → Prise" },
  continuity: {
    label: "Continuité",
    chain: "Dernière image du plan précédent → image de départ → Vidéo → Prise",
  },
  free: { label: "Libre", chain: "Prompt → Image → Prise → Vidéo → Prise" },
};

export const RECIPE_ORDER: RecipeId[] = ["character", "location", "object", "continuity", "free"];

export function isRecipeId(v: string): v is RecipeId {
  return v in RECIPES;
}

/** Recipe picked from what the shot contains (used by the digester and on first open). */
export function suggestRecipe(tags: ReferenceTag[]): RecipeId {
  if (tags.includes("character")) return "character";
  if (tags.includes("object")) return "object";
  if (tags.includes("location") || tags.includes("look")) return "location";
  return "free";
}

export interface RecipeModels {
  /** text → image */
  t2i?: string | null;
  /** multi-reference edit */
  i2i?: string | null;
  /** image → video */
  i2v?: string | null;
}

class GraphBuilder {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  private n = 0;

  add(type: NodeType, x: number, y: number, data: GraphNodeData = {}): string {
    const id = `${type}-${++this.n}`;
    this.nodes.push({ id, type, position: { x, y }, data });
    return id;
  }

  link(source: string, sourceHandle: string, target: string, targetHandle: string) {
    this.edges.push({ id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`, source, sourceHandle, target, targetHandle });
  }

  graph(): ShotGraphData {
    return { nodes: this.nodes, edges: this.edges };
  }
}

const COL = { refs: 0, mid: 320, gen: 660, take: 1000, video: 1340, vtake: 1680 };

export function buildRecipeGraph(
  recipe: RecipeId,
  refs: { id: string; tag: ReferenceTag }[],
  models: RecipeModels = {},
): ShotGraphData {
  const g = new GraphBuilder();
  const refNodes = refs.map((r, i) => g.add("reference", COL.refs, i * 150, { referenceId: r.id }));
  const prompt = g.add("promptBuilder", COL.mid, recipe === "continuity" ? 260 : 220, recipe === "free" ? { override: "" } : {});
  refNodes.forEach((id) => g.link(id, "ref", prompt, "refs"));

  const video = g.add("videoGen", COL.video, 60, { modelId: models.i2v ?? undefined });
  const vtake = g.add("take", COL.vtake, 60, { stage: "video" });
  g.link(prompt, "prompt", video, "prompt");
  g.link(video, "video", vtake, "in");

  if (recipe === "continuity") {
    const frame = g.add("frameExtract", COL.mid, 0, { source: "previous_shot", which: "last" });
    g.link(frame, "image", video, "start");
    return g.graph();
  }

  const multiRef = recipe === "character" || recipe === "object";
  const gen = g.add(multiRef ? "imageEdit" : "imageGen", COL.gen, 60, {
    modelId: (multiRef ? models.i2i : models.t2i) ?? undefined,
  });
  g.link(prompt, "prompt", gen, "prompt");
  if (multiRef) {
    const selector = g.add("refSelector", COL.mid, 0);
    refNodes.forEach((id) => g.link(id, "ref", selector, "refs"));
    g.link(selector, "views", gen, "views");
  }
  const take = g.add("take", COL.take, 60, { stage: "keyframe" });
  g.link(gen, "image", take, "in");
  g.link(take, "out", video, "start");
  return g.graph();
}

/** Keeps Reference nodes in step with the shot's refIds (inspector or drag & drop). */
export function syncReferenceNodes(graph: ShotGraphData, refIds: string[]): ShotGraphData {
  const keep = graph.nodes.filter((n) => n.type !== "reference" || (n.data.referenceId && refIds.includes(n.data.referenceId)));
  const removed = new Set(graph.nodes.filter((n) => !keep.includes(n)).map((n) => n.id));
  let edges = graph.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
  const nodes = [...keep];
  const present = new Set(nodes.filter((n) => n.type === "reference").map((n) => n.data.referenceId));
  const consumers = nodes.filter((n) => n.type === "refSelector" || n.type === "promptBuilder");
  let y = Math.max(-150, ...nodes.filter((n) => n.type === "reference").map((n) => n.position.y));
  for (const refId of refIds) {
    if (present.has(refId)) continue;
    y += 150;
    const id = uniqueId(nodes, "reference");
    nodes.push({ id, type: "reference", position: { x: 0, y }, data: { referenceId: refId } });
    for (const c of consumers) {
      edges = [...edges, { id: `e-${id}-ref-${c.id}-refs`, source: id, sourceHandle: "ref", target: c.id, targetHandle: "refs" }];
    }
  }
  return { nodes, edges };
}

export function refIdsFromGraph(graph: ShotGraphData): string[] {
  return [...new Set(graph.nodes.filter((n) => n.type === "reference" && n.data.referenceId).map((n) => n.data.referenceId!))];
}

export function uniqueId(nodes: { id: string }[], type: NodeType): string {
  let i = nodes.length + 1;
  while (nodes.some((n) => n.id === `${type}-${i}`)) i++;
  return `${type}-${i}`;
}

/** Generation nodes, in chain order (keyframe first, then video). */
export function generationNodes(graph: ShotGraphData): GraphNode[] {
  return graph.nodes
    .filter((n) => NODE_SPECS[n.type].generates)
    .sort((a, b) => (NODE_SPECS[a.type].generates === "keyframe" ? 0 : 1) - (NODE_SPECS[b.type].generates === "keyframe" ? 0 : 1));
}
