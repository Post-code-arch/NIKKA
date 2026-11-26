import { z } from "zod";

/**
 * Project canvas: a free node graph, independent of sequences and shots.
 * Node types: inputs (text, image, video, bible reference, negative), a
 * prompt enhancer (LLM) and three generators (text → image, text → video, image → video). New node types (V2: depth,
 * mask, relight…) are added here without touching the engine.
 */

/** "negative" is its own type so a negative prompt is never wired into a prompt by mistake. */
export type PortType = "text" | "image" | "video" | "negative";

export const PORT_COLOR: Record<PortType, string> = {
  text: "var(--port-text)",
  image: "var(--port-image)",
  video: "var(--port-video)",
  negative: "var(--port-negative)",
};

export const PORT_LABEL: Record<PortType, string> = {
  text: "texte",
  image: "image",
  video: "vidéo",
  negative: "négatif",
};

export interface PortSpec {
  id: string;
  type: PortType;
  label?: string;
  /** Accepts several links (joined texts, several reference images). */
  multiple?: boolean;
  /** Optional input: only used when the model supports it. */
  optional?: boolean;
}

export const NODE_TYPES = ["text", "image", "video", "reference", "negative", "promptEnhancer", "textToImage", "textToVideo", "imageToVideo"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeSpec {
  label: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Generators call a model of this kind and produce results. */
  model?: "t2i" | "t2v" | "i2v";
  /** Other model kinds the node may use (text → image with references uses an edit model). */
  altModels?: ("i2i")[];
  /** Calls the LLM (text in, text out). */
  llm?: boolean;
}

export const NODE_SPECS: Record<NodeType, NodeSpec> = {
  text: {
    label: "Texte",
    description: "Un prompt écrit à la main",
    inputs: [],
    outputs: [{ id: "text", type: "text" }],
  },
  image: {
    label: "Image",
    description: "Une image importée de ton disque",
    inputs: [],
    outputs: [{ id: "image", type: "image" }],
  },
  video: {
    label: "Vidéo",
    description: "Une vidéo importée de ton disque",
    inputs: [],
    outputs: [{ id: "video", type: "video" }],
  },
  reference: {
    label: "Référence",
    description: "Un personnage, lieu ou objet de la bible : ses images et son descripteur",
    inputs: [],
    outputs: [
      { id: "images", type: "image", label: "images" },
      { id: "text", type: "text", label: "descripteur" },
    ],
  },
  negative: {
    label: "Négatif",
    description: "Ce que le modèle doit éviter (si le modèle l'accepte)",
    inputs: [],
    outputs: [{ id: "negative", type: "negative" }],
  },
  promptEnhancer: {
    label: "Prompt enhancer",
    description: "Un LLM réécrit et enrichit ton prompt",
    inputs: [{ id: "prompt", type: "text", label: "prompt" }],
    outputs: [{ id: "text", type: "text", label: "prompt enrichi" }],
    llm: true,
  },
  textToImage: {
    label: "Texte → image",
    description: "Génère une image à partir d'un texte",
    inputs: [
      { id: "prompt", type: "text", label: "prompt", multiple: true },
      { id: "refs", type: "image", label: "références", multiple: true, optional: true },
      { id: "negative", type: "negative", label: "négatif", optional: true },
    ],
    outputs: [{ id: "image", type: "image" }],
    model: "t2i",
    altModels: ["i2i"],
  },
  textToVideo: {
    label: "Texte → vidéo",
    description: "Génère une vidéo à partir d'un texte",
    inputs: [
      { id: "prompt", type: "text", label: "prompt", multiple: true },
      { id: "negative", type: "negative", label: "négatif", optional: true },
    ],
    outputs: [{ id: "video", type: "video" }],
    model: "t2v",
  },
  imageToVideo: {
    label: "Image → vidéo",
    description: "Anime une image",
    inputs: [
      { id: "image", type: "image", label: "image de départ" },
      { id: "end", type: "image", label: "image de fin", optional: true },
      { id: "prompt", type: "text", label: "prompt", multiple: true },
      { id: "negative", type: "negative", label: "négatif", optional: true },
    ],
    outputs: [{ id: "video", type: "video" }],
    model: "i2v",
  },
};

export const NODE_ORDER: NodeType[] = [...NODE_TYPES];

export const GraphNodeDataSchema = z.looseObject({
  /** text; prompt enhancer: its (editable) result */
  text: z.string().optional(),
  /** prompt enhancer: generator it writes for, extra instruction, input it was made from */
  target: z.enum(["image", "video"]).optional(),
  instruction: z.string().max(500).optional(),
  source: z.string().optional(),
  /** reference: the bible reference it brings */
  referenceId: z.string().optional(),
  /** image / video: the imported file */
  assetId: z.string().optional(),
  /** generators */
  modelId: z.string().optional(),
  seed: z.number().int().optional(),
  seedLocked: z.boolean().optional(),
  durationSec: z.number().positive().max(60).optional(),
  /** generators: the result passed downstream (default: latest completed). */
  selectedRunId: z.string().optional(),
});
export type GraphNodeData = z.infer<typeof GraphNodeDataSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
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

export const CanvasGraphSchema = z.object({ nodes: z.array(GraphNodeSchema), edges: z.array(GraphEdgeSchema) });
export type CanvasGraph = z.infer<typeof CanvasGraphSchema>;

export function portType(graph: CanvasGraph, nodeId: string, handle: string, side: "in" | "out"): PortType | null {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const spec = NODE_SPECS[node.type];
  return (side === "in" ? spec.inputs : spec.outputs).find((p) => p.id === handle)?.type ?? null;
}

/** A link is valid when both ports exist and carry the same type. */
export function isValidEdge(graph: CanvasGraph, e: Pick<GraphEdge, "source" | "sourceHandle" | "target" | "targetHandle">) {
  if (e.source === e.target) return false;
  const out = portType(graph, e.source, e.sourceHandle, "out");
  const inp = portType(graph, e.target, e.targetHandle, "in");
  return !!out && out === inp;
}

export function incoming(graph: CanvasGraph, nodeId: string, handle: string): GraphNode[] {
  return graph.edges
    .filter((e) => e.target === nodeId && e.targetHandle === handle)
    .map((e) => graph.nodes.find((n) => n.id === e.source))
    .filter((n): n is GraphNode => !!n);
}

export function uniqueId(nodes: { id: string }[], type: NodeType): string {
  let i = nodes.length + 1;
  while (nodes.some((n) => n.id === `${type}-${i}`)) i++;
  return `${type}-${i}`;
}

/** Keeps only what the current node set understands (older canvases may hold other nodes). */
export function sanitizeGraph(input: unknown): CanvasGraph {
  const raw = (input ?? {}) as { nodes?: unknown[]; edges?: unknown[] };
  const nodes = (raw.nodes ?? []).flatMap((n) => {
    const p = GraphNodeSchema.safeParse(n);
    return p.success ? [p.data] : [];
  });
  const graph: CanvasGraph = { nodes, edges: [] };
  graph.edges = (raw.edges ?? []).flatMap((e) => {
    const p = GraphEdgeSchema.safeParse(e);
    return p.success && isValidEdge(graph, p.data) ? [p.data] : [];
  });
  return graph;
}

/** Can this input port take one more link? (single inputs are replaced) */
export function acceptsMany(graph: CanvasGraph, nodeId: string, handle: string) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  return !!node && !!NODE_SPECS[node.type].inputs.find((p) => p.id === handle)?.multiple;
}
