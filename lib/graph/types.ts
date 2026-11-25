import { z } from "zod";

/**
 * Project canvas: a free node graph, independent of sequences and shots.
 * Six node types: three inputs (text, image, video) and three generators
 * (text → image, text → video, image → video). New node types (V2: depth,
 * mask, relight…) are added here without touching the engine.
 */

export type PortType = "text" | "image" | "video";

export const PORT_COLOR: Record<PortType, string> = {
  text: "var(--port-text)",
  image: "var(--port-image)",
  video: "var(--port-video)",
};

export const PORT_LABEL: Record<PortType, string> = {
  text: "texte",
  image: "image",
  video: "vidéo",
};

export interface PortSpec {
  id: string;
  type: PortType;
  label?: string;
}

export type NodeType = "text" | "image" | "video" | "textToImage" | "textToVideo" | "imageToVideo";

export interface NodeSpec {
  label: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Generators call a model of this kind and produce results. */
  model?: "t2i" | "t2v" | "i2v";
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
  textToImage: {
    label: "Texte → image",
    description: "Génère une image à partir d'un texte",
    inputs: [{ id: "prompt", type: "text", label: "prompt" }],
    outputs: [{ id: "image", type: "image" }],
    model: "t2i",
  },
  textToVideo: {
    label: "Texte → vidéo",
    description: "Génère une vidéo à partir d'un texte",
    inputs: [{ id: "prompt", type: "text", label: "prompt" }],
    outputs: [{ id: "video", type: "video" }],
    model: "t2v",
  },
  imageToVideo: {
    label: "Image → vidéo",
    description: "Anime une image",
    inputs: [
      { id: "image", type: "image", label: "image de départ" },
      { id: "prompt", type: "text", label: "prompt" },
    ],
    outputs: [{ id: "video", type: "video" }],
    model: "i2v",
  },
};

export const NODE_ORDER: NodeType[] = ["text", "image", "video", "textToImage", "textToVideo", "imageToVideo"];

export const GraphNodeDataSchema = z.looseObject({
  /** text */
  text: z.string().optional(),
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
  type: z.enum(["text", "image", "video", "textToImage", "textToVideo", "imageToVideo"]),
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
