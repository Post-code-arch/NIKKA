"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { ChevronLeft, Crosshair, Film, Grid2x2, Minus, Plus, Sparkles } from "lucide-react";
import { ReferenceDetail } from "@/components/bible/reference-detail";
import { GradientEdge } from "@/components/nodes/gradient-edge";
import { IconPill, Island, Pill } from "@/components/ui/pill";
import { PORT_COLOR, isValidEdge, portType, type GraphNodeData, type NodeType, type ShotGraphData } from "@/lib/graph/types";
import type { ShotPromptPreview } from "@/lib/prompt/shot";
import type { ProjectTree, ShotWithTakes } from "@/lib/projects/queries";
import { RECIPES, RECIPE_ORDER, uniqueId, type RecipeId } from "@/lib/recipes";
import { TAG_COLOR_VAR } from "@/lib/refs/views";
import { api } from "@/lib/store/api";
import { useModels } from "@/lib/store/models";
import { useProjectStore } from "@/lib/store/project-store";
import { GraphContext, NodePalette, graphNodeTypes, type PALETTE } from "./graph-nodes";
import { useRunner } from "./run-confirm";

export const NIKKA_REF_MIME = "application/nikka-ref";

const edgeTypes = { gradient: GradientEdge };

/** Leave room for the Bible panel on the left and the header on top. */
const FIT = { padding: { top: "130px", bottom: "60px", left: "310px", right: "90px" } } as const;

type RfNode = Node<GraphNodeData, NodeType>;

function edgeColor(graph: ShotGraphData, e: { source: string; sourceHandle: string }, project: ProjectTree) {
  const src = graph.nodes.find((n) => n.id === e.source);
  if (src?.type === "reference") {
    const ref = project.references.find((r) => r.id === src.data.referenceId);
    return ref ? TAG_COLOR_VAR[ref.tag] : PORT_COLOR.ref;
  }
  const t = portType(graph, e.source, e.sourceHandle, "out");
  return t ? PORT_COLOR[t] : "var(--edge)";
}

function toFlow(graph: ShotGraphData, project: ProjectTree): { nodes: RfNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: graph.edges.map((e) => ({ ...e, type: "gradient", data: { from: edgeColor(graph, e, project) } })),
  };
}

function fromFlow(nodes: RfNode[], edges: Edge[]): ShotGraphData {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type as NodeType, position: n.position, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? "",
      target: e.target,
      targetHandle: e.targetHandle ?? "",
    })),
  };
}

/** Unfolded recipe of one shot: its sub-graph, editable (PRD §9). */
export function ShotGraph({
  project,
  shot,
  number,
  onBack,
}: {
  project: ProjectTree;
  shot: ShotWithTakes;
  number: string;
  onBack: () => void;
}) {
  const rf = useReactFlow();
  const refresh = useProjectStore((s) => s.refresh);
  const models = useModels()?.models ?? [];
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [recipeId, setRecipeId] = useState<RecipeId>("free");
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<ShotPromptPreview | null>(null);
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number } } | null>(null);
  const [refDetail, setRefDetail] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const latest = useRef({ nodes, edges });
  useEffect(() => {
    latest.current = { nodes, edges };
  }, [nodes, edges]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (res: { graph: ShotGraphData; recipeId: RecipeId }) => {
      const flow = toFlow(res.graph, useProjectStore.getState().project ?? project);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setRecipeId(res.recipeId);
      setLoaded(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shot.id],
  );
  const load = useCallback(
    () => api<{ graph: ShotGraphData; recipeId: RecipeId }>(`/api/shots/${shot.id}/graph`).then(apply),
    [shot.id, apply],
  );

  useEffect(() => {
    void api<{ graph: ShotGraphData; recipeId: RecipeId }>(`/api/shots/${shot.id}/graph`).then((res) => {
      apply(res);
      setTimeout(() => rf.fitView(FIT), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id]);

  const save = useCallback(
    (immediate = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const send = async () => {
        const graph = fromFlow(latest.current.nodes, latest.current.edges);
        await api(`/api/shots/${shot.id}/graph`, { method: "PUT", body: { graph } });
        await refresh();
      };
      if (immediate) void send();
      else saveTimer.current = setTimeout(() => void send(), 400);
    },
    [shot.id, refresh],
  );

  // Models used by the graph's generation nodes drive the preview (camera wording, slots).
  const keyframeNode = nodes.find((n) => n.type === "imageEdit" || n.type === "imageGen");
  const videoNode = nodes.find((n) => n.type === "videoGen");
  const kfModel = keyframeNode?.data.modelId ?? models.find((m) => m.kind === (keyframeNode?.type === "imageEdit" ? "i2i" : "t2i"))?.id;
  const vModel = videoNode?.data.modelId ?? models.find((m) => m.kind === "i2v")?.id;
  const previewKey = JSON.stringify([shot.camera, shot.refIds, shot.description.value, kfModel, vModel, project.references.map((r) => r.descriptor + r.variants.map((v) => v.views.length))]);
  useEffect(() => {
    if (!loaded) return;
    let stale = false;
    const q = new URLSearchParams();
    if (kfModel) q.set("keyframe", kfModel);
    if (vModel) q.set("video", vModel);
    // Only the latest request may update the preview (responses can arrive out of order).
    void api<ShotPromptPreview>(`/api/shots/${shot.id}/prompt?${q}`).then((p) => {
      if (!stale) setPreview(p);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, loaded]);

  const afterRun = useCallback(() => {
    void refresh();
    void load();
  }, [refresh, load]);
  const { run, dialog } = useRunner(afterRun);

  const updateData = useCallback(
    (nodeId: string, patch: Partial<GraphNodeData>) => {
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
      setTimeout(() => save(), 30);
    },
    [setNodes, save],
  );

  const graphNow = () => fromFlow(latest.current.nodes, latest.current.edges);

  const onConnect = (c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    const graph = graphNow();
    const conn = { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle };
    if (!isValidEdge(graph, conn)) return;
    const target = graph.nodes.find((n) => n.id === c.target)!;
    const multiple = target.type === "refSelector" || target.type === "promptBuilder";
    const id = `e-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}`;
    setEdges((es) => [
      // A single-input port is replaced, not doubled.
      ...es.filter((e) => e.id !== id && (multiple || !(e.target === c.target && e.targetHandle === c.targetHandle))),
      { ...conn, id, type: "gradient", data: { from: edgeColor(graph, conn, project) } },
    ]);
    setTimeout(() => save(true), 30);
  };

  const addNode = (item: (typeof PALETTE)[number], at: { x: number; y: number }) => {
    const id = uniqueId(latest.current.nodes, item.type);
    const defaultModel =
      item.type === "imageGen" ? models.find((m) => m.kind === "t2i")?.id
      : item.type === "imageEdit" ? models.find((m) => m.kind === "i2i")?.id
      : item.type === "videoGen" ? models.find((m) => m.kind === "i2v")?.id
      : undefined;
    setNodes((ns) => [...ns, { id, type: item.type, position: at, data: { ...(item.data ?? {}), ...(defaultModel ? { modelId: defaultModel } : {}) } }]);
    setPalette(null);
    setTimeout(() => save(true), 30);
  };

  const openPalette = (clientX: number, clientY: number) => {
    const box = wrapper.current?.getBoundingClientRect();
    if (!box) return;
    setPalette({
      x: Math.min(clientX - box.left, box.width - 250),
      y: Math.min(clientY - box.top, box.height - 420),
      flow: rf.screenToFlowPosition({ x: clientX, y: clientY }),
    });
  };

  const branchReference = async (referenceId: string) => {
    if (shot.refIds.includes(referenceId)) return;
    await api(`/api/shots/${shot.id}`, { method: "PATCH", body: { refIds: [...shot.refIds, referenceId] } });
    await refresh();
    await load();
  };

  const changeRecipe = async (next: RecipeId) => {
    if (next === recipeId) return;
    if (!confirm(`Remplacer le graphe par la recette « ${RECIPES[next].label} » ? Les prises sont conservées.`)) return;
    await api(`/api/shots/${shot.id}/recipe`, { body: { recipeId: next } });
    await refresh();
    await load();
    setTimeout(() => rf.fitView(FIT), 50);
  };

  const ctx = {
    project,
    shot,
    models,
    preview,
    updateData,
    run: (nodeId: string, variants: number) => void run({ shotId: shot.id, nodeId, variants }),
    selectTake: (takeId: string, nodeId: string) => {
      // Keep the local graph in step so a pending save cannot drop the choice.
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, takeId } } : n)));
      void api(`/api/shots/${shot.id}/select-take`, { body: { takeId, nodeId } }).then(() => refresh());
    },
    openReference: (id: string) => setRefDetail(id),
    promoteReference: (id: string) =>
      void api(`/api/references/${id}`, { method: "PATCH", body: { scope: "bible" } }).then(() => refresh()),
  };

  return (
    <GraphContext.Provider value={ctx}>
      <div
        ref={wrapper}
        className="relative flex-1"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) openPalette(e.clientX, e.clientY);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(NIKKA_REF_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(NIKKA_REF_MIME);
          if (id) {
            e.preventDefault();
            void branchReference(id);
          }
        }}
      >
        {loaded && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={() => save()}
            onNodesDelete={() => setTimeout(() => save(true), 30)}
            onEdgesDelete={() => setTimeout(() => save(true), 30)}
            isValidConnection={(c) =>
              !!c.sourceHandle &&
              !!c.targetHandle &&
              isValidEdge(graphNow(), { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle })
            }
            nodeTypes={graphNodeTypes}
            edgeTypes={edgeTypes}
            deleteKeyCode={["Backspace", "Delete"]}
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="rgba(255,255,255,0.07)" />
          </ReactFlow>
        )}

        <div className="pointer-events-none absolute top-3 right-4 left-[300px] z-10 flex items-center justify-between gap-2">
          <Island className="pointer-events-auto">
            <Pill className="bg-transparent" onClick={onBack}>
              <ChevronLeft /> Séquence
            </Pill>
            <span className="px-2 font-mono text-xs">Plan {number}</span>
            <select
              value={recipeId}
              onChange={(e) => void changeRecipe(e.target.value as RecipeId)}
              title={RECIPES[recipeId].chain}
              className="h-8 rounded-[10px] bg-surface-2 px-2 text-xs outline-none"
            >
              {RECIPE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {RECIPES[r].label}
                </option>
              ))}
            </select>
            <Pill onClick={(e) => openPalette(e.clientX, e.clientY + 24)}>
              <Plus /> Node
            </Pill>
          </Island>
          <Island className="pointer-events-auto">
            <Pill className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" onClick={() => void run({ shotId: shot.id, until: "keyframe" })}>
              <Sparkles /> Image clé
            </Pill>
            <Pill onClick={() => void run({ shotId: shot.id, until: "video" })}>
              <Film /> Animer
            </Pill>
          </Island>
        </div>

        <Island className="absolute top-1/2 right-4 z-10 -translate-y-1/2 flex-col">
          <IconPill className="bg-transparent" aria-label="Zoom avant" onClick={() => rf.zoomIn()}><Plus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Zoom arrière" onClick={() => rf.zoomOut()}><Minus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Ajuster" onClick={() => rf.fitView(FIT)}><Grid2x2 /></IconPill>
          <IconPill className="bg-transparent" aria-label="Recentrer" onClick={() => rf.fitView({ ...FIT, maxZoom: 0.8 })}><Crosshair /></IconPill>
        </Island>

        <p className="pointer-events-none absolute right-4 bottom-4 z-10 text-right text-[10px] text-muted-foreground">
          Double-clic sur le fond : ajouter un node · glisse une référence de la bible ici pour la brancher · Suppr : effacer
        </p>

        {palette && (
          <NodePalette
            x={palette.x}
            y={palette.y}
            references={project.references.map((r) => ({ id: r.id, name: r.name, tag: r.tag }))}
            onClose={() => setPalette(null)}
            onPick={(item) => {
              if (item.type === "reference" && item.data?.referenceId) {
                setPalette(null);
                void branchReference(item.data.referenceId);
              } else addNode(item, palette.flow);
            }}
          />
        )}
        {dialog}
        {refDetail && (
          <ReferenceDetail referenceId={refDetail} onClose={() => { setRefDetail(null); void refresh(); }} onChanged={() => void refresh()} />
        )}
      </div>
    </GraphContext.Provider>
  );
}
