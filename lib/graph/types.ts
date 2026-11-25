import { z } from "zod";

/**
 * Shot sub-graph (PRD §9). A node = { type, typed inputs/outputs, params,
 * server executor }. V2 processing nodes (depth, mask, relight…) add entries
 * here without touching the engine.
 */

export type PortType = "ref" | "views" | "text" | "image" | "video";

export const PORT_COLOR: Record<PortType, string> = {
  ref: "var(--tag-character)",
  views: "var(--tag-composition)",
  text: "var(--port-text)",
  image: "var(--port-image)",
  video: "var(--port-video)",
};

export const PORT_LABEL: Record<PortType, string> = {
  ref: "références",
  views: "vues",
  text: "prompt",
  image: "image",
  video: "vidéo",
};

export interface PortSpec {
  id: string;
  type: PortType;
  label?: string;
  /** Several edges may arrive on this input. */
  multiple?: boolean;
  optional?: boolean;
}

export type NodeType =
  | "reference"
  | "refSelector"
  | "promptBuilder"
  | "imageGen"
  | "imageEdit"
  | "videoGen"
  | "frameExtract"
  | "take";

export interface NodeSpec {
  label: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Generation nodes call a model and create takes. */
  generates?: "keyframe" | "video";
}

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  reference: {
    label: "Référence",
    description: "Un personnage, un lieu, un objet ou un look (bible ou local)",
    inputs: [],
    outputs: [{ id: "ref", type: "ref" }],
  },
  refSelector: {
    label: "Sélection des vues",
    description: "Choisit les vues à envoyer selon l'échelle du plan",
    inputs: [{ id: "refs", type: "ref", multiple: true }],
    outputs: [{ id: "views", type: "views" }],
  },
  promptBuilder: {
    label: "Prompt",
    description: "Descripteurs + action + caméra + look",
    inputs: [{ id: "refs", type: "ref", multiple: true, optional: true }],
    outputs: [{ id: "prompt", type: "text" }],
  },
  imageGen: {
    label: "Image · texte → image",
    description: "Génère une image clé depuis le prompt",
    inputs: [{ id: "prompt", type: "text" }],
    outputs: [{ id: "image", type: "image" }],
    generates: "keyframe",
  },
  imageEdit: {
    label: "Image · édition multi-réf",
    description: "Génère une image clé fidèle aux références",
    inputs: [
      { id: "prompt", type: "text" },
      { id: "views", type: "views" },
    ],
    outputs: [{ id: "image", type: "image" }],
    generates: "keyframe",
  },
  videoGen: {
    label: "Vidéo · image → vidéo",
    description: "Anime une image de départ",
    inputs: [
      { id: "start", type: "image", label: "image de départ" },
      { id: "prompt", type: "text" },
    ],
    outputs: [{ id: "video", type: "video" }],
    generates: "video",
  },
  frameExtract: {
    label: "Extraction d'image",
    description: "Dernière (ou première) image d'une vidéo",
    inputs: [{ id: "video", type: "video", optional: true }],
    outputs: [{ id: "image", type: "image" }],
  },
  take: {
    label: "Prise",
    description: "Les prises produites ; la prise retenue continue la chaîne",
    inputs: [{ id: "in", type: "image", label: "entrée" }],
    outputs: [{ id: "out", type: "image", label: "retenue" }],
  },
};

/** Take nodes carry image or video depending on the stage they collect. */
export function portsOf(type: NodeType, data: GraphNodeData): { inputs: PortSpec[]; outputs: PortSpec[] } {
  const spec = NODE_SPECS[type];
  if (type === "take" && data.stage === "video") {
    return { inputs: [{ id: "in", type: "video", label: "entrée" }], outputs: [{ id: "out", type: "video", label: "retenue" }] };
  }
  return spec;
}

export const GraphNodeDataSchema = z.looseObject({
  /** reference: the Reference row. */
  referenceId: z.string().optional(),
  /** generation nodes */
  modelId: z.string().optional(),
  seed: z.number().int().optional(),
  seedLocked: z.boolean().optional(),
  /** refSelector: manual override of the automatic choice (asset ids). */
  manualViews: z.array(z.string()).optional(),
  /** promptBuilder: free text replacing the shot action (recipe « Libre »). */
  override: z.string().optional(),
  /** take: which stage it collects and the retained take. */
  stage: z.enum(["sketch", "keyframe", "video"]).optional(),
  takeId: z.string().optional(),
  /** frameExtract */
  source: z.enum(["input", "previous_shot"]).optional(),
  which: z.enum(["last", "first"]).optional(),
});
export type GraphNodeData = z.infer<typeof GraphNodeDataSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["reference", "refSelector", "promptBuilder", "imageGen", "imageEdit", "videoGen", "frameExtract", "take"]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: GraphNodeDataSchema,
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const ShotGraphSchema = z.object({ nodes: z.array(GraphNodeSchema), edges: z.array(GraphEdgeSchema) });
export type ShotGraphData = z.infer<typeof ShotGraphSchema>;

export function portType(graph: ShotGraphData, nodeId: string, handle: string, side: "in" | "out"): PortType | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const ports = portsOf(node.type, node.data);
  return (side === "in" ? ports.inputs : ports.outputs).find((p) => p.id === handle)?.type ?? null;
}

/** An edge is valid when both ports exist and carry the same type. */
export function isValidEdge(graph: ShotGraphData, e: Pick<GraphEdge, "source" | "sourceHandle" | "target" | "targetHandle">) {
  if (e.source === e.target) return false;
  const out = portType(graph, e.source, e.sourceHandle, "out");
  const inp = portType(graph, e.target, e.targetHandle, "in");
  return !!out && out === inp;
}

export function incoming(graph: ShotGraphData, nodeId: string, handle: string): GraphNode[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handle)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => !!n);
}

export function outgoing(graph: ShotGraphData, nodeId: string): GraphNode[] {
  return graph.edges
    .filter((e) => e.source === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => !!n);
}
