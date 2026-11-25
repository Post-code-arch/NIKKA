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
import { ChevronDown, Crosshair, Grid2x2, LayoutTemplate, Minus, Plus } from "lucide-react";
import { MovementIcon, ScaleIcon } from "@/components/camera/icons";
import type { NodeRun } from "@/db/schema";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
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

/** Free node canvas of one shot: the user builds the workflow (templates optional). */
export function ShotGraph({
  project,
  shot,
  number,
}: {
  project: ProjectTree;
  shot: ShotWithTakes;
  number: string;
}) {
  const rf = useReactFlow();
  const refresh = useProjectStore((s) => s.refresh);
  const models = useModels()?.models ?? [];
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [runs, setRuns] = useState<NodeRun[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
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

  type CanvasResponse = { graph: ShotGraphData; runs: NodeRun[] };
  const apply = useCallback(
    (res: CanvasResponse) => {
      const flow = toFlow(res.graph, useProjectStore.getState().project ?? project);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setRuns(res.runs);
      setLoaded(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shot.id],
  );
  const load = useCallback(() => api<CanvasResponse>(`/api/shots/${shot.id}/graph`).then(apply), [shot.id, apply]);
  const loadRuns = useCallback(
    () => api<CanvasResponse>(`/api/shots/${shot.id}/graph`).then((r) => setRuns(r.runs)),
    [shot.id],
  );

  useEffect(() => {
    void api<CanvasResponse>(`/api/shots/${shot.id}/graph`).then((res) => {
      apply(res);
      // An empty canvas starts at 100 % (fitting nothing would zoom in to the max).
      setTimeout(() => (res.graph.nodes.length ? rf.fitView(FIT) : rf.setViewport({ x: 320, y: 140, zoom: 1 })), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id]);

  // Follow generations in progress (results only: never overwrite local edits).
  const pending = runs.some((r) => r.status === "queued" || r.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void fetch("/api/jobs?active=1").finally(() => void loadRuns());
    }, 1500);
    return () => clearInterval(t);
  }, [pending, loadRuns]);

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
    void loadRuns();
  }, [refresh, loadRuns]);
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
    const multiple = target.type === "refSelector" || target.type === "promptBuilder" || (target.type === "imageEdit" && c.targetHandle === "images");
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

  const insertTemplate = async (recipe: RecipeId) => {
    setTemplatesOpen(false);
    // Save pending edits first, then insert below the existing nodes.
    await api(`/api/shots/${shot.id}/graph`, { method: "PUT", body: { graph: graphNow() } });
    const bottom = latest.current.nodes.reduce((y, n) => Math.max(y, n.position.y + 420), 0);
    await api(`/api/shots/${shot.id}/template`, { body: { recipeId: recipe, x: 0, y: latest.current.nodes.length ? bottom : 0 } });
    await load();
    await refresh();
    setTimeout(() => rf.fitView(FIT), 60);
  };

  const ctx = {
    project,
    shot,
    models,
    preview,
    runs,
    graph: fromFlow(nodes, edges),
    updateData,
    run: (nodeId: string, variants: number) => {
      // Run on the saved graph: flush edits first.
      void api(`/api/shots/${shot.id}/graph`, { method: "PUT", body: { graph: graphNow() } }).then(() =>
        run({ shotId: shot.id, nodeId, variants }),
      );
    },
    sendToShot: (runId: string) =>
      void api(`/api/node-runs/${runId}/send`, { body: {} }).then(() => {
        void loadRuns();
        void refresh();
      }),
    uploadImage: (nodeId: string, file: File) => {
      const form = new FormData();
      form.append("files", file);
      void fetch("/api/assets", { method: "POST", body: form })
        .then((r) => r.json())
        .then((assets: { id: string }[]) => assets[0] && updateData(nodeId, { assetId: assets[0].id }));
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
            addNode({ type: "reference", data: { referenceId: id }, group: "Entrées" }, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
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

        <div className="pointer-events-none absolute top-3 right-4 left-[300px] z-10 flex items-start gap-2">
          <Island className="pointer-events-auto max-w-[520px]">
            <span className="flex shrink-0 items-center gap-1.5 px-2 text-xs">
              <span className="font-mono">Plan {number}</span>
              <ScaleIcon scale={(shot.camera?.value ?? DEFAULT_CAMERA).scale} className="size-4 text-muted-foreground" />
              <MovementIcon movement={(shot.camera?.value ?? DEFAULT_CAMERA).movement} className="size-4 text-muted-foreground" />
            </span>
            <span className="min-w-0 truncate pr-2 text-[11px] text-muted-foreground" title={shot.description.value}>
              {shot.description.value || "Sans action"}
            </span>
          </Island>
          <Island className="pointer-events-auto relative">
            <Pill onClick={(e) => openPalette(e.clientX, e.clientY + 24)}>
              <Plus /> Node
            </Pill>
            <Pill onClick={() => setTemplatesOpen((o) => !o)}>
              <LayoutTemplate /> Modèles <ChevronDown />
            </Pill>
            {templatesOpen && (
              <div className="island absolute top-11 right-0 z-30 w-80 p-1.5">
                <div className="px-2 py-1 text-[10px] text-muted-foreground">Insérer un modèle (modifiable ensuite)</div>
                {RECIPE_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => void insertTemplate(r)}
                    className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <div className="text-xs">{RECIPES[r].label}</div>
                    <div className="text-[10px] text-muted-foreground">{RECIPES[r].chain}</div>
                  </button>
                ))}
              </div>
            )}
          </Island>
        </div>

        {loaded && nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <div className="island pointer-events-auto w-96 p-4 text-center">
              <p className="mb-1 text-sm">Canvas vide</p>
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                Construis ton workflow : <b>+ Node</b> ou double-clic sur le fond, glisse une référence de la bible, puis relie
                les ports. Les résultats restent ici ; « Envoyer au plan » les ajoute aux prises du storyboard.
              </p>
              <div className="flex flex-wrap justify-center gap-1">
                {RECIPE_ORDER.map((r) => (
                  <Pill key={r} className="h-7 text-[11px]" onClick={() => void insertTemplate(r)} title={RECIPES[r].chain}>
                    {RECIPES[r].label}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        )}

        <Island className="absolute top-1/2 right-4 z-10 -translate-y-1/2 flex-col">
          <IconPill className="bg-transparent" aria-label="Zoom avant" onClick={() => rf.zoomIn()}><Plus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Zoom arrière" onClick={() => rf.zoomOut()}><Minus /></IconPill>
          <IconPill className="bg-transparent" aria-label="Ajuster" onClick={() => rf.fitView(FIT)}><Grid2x2 /></IconPill>
          <IconPill className="bg-transparent" aria-label="Recentrer" onClick={() => rf.fitView({ ...FIT, maxZoom: 0.8 })}><Crosshair /></IconPill>
        </Island>

        <p className="pointer-events-none absolute top-[68px] right-4 z-10 text-right text-[10px] text-muted-foreground">
          Double-clic sur le fond : ajouter un node · glisse une référence de la bible ici · Suppr : effacer
        </p>

        {palette && (
          <NodePalette
            x={palette.x}
            y={palette.y}
            references={project.references.map((r) => ({ id: r.id, name: r.name, tag: r.tag }))}
            onClose={() => setPalette(null)}
            onPick={(item) => {
              addNode(item, palette.flow);
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
