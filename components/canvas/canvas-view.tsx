"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type FinalConnectionState,
  type Edge,
  type Node,
} from "@xyflow/react";
import { BoxSelect, Copy, Crosshair, Grid2x2, Minus, Plus, Trash2, X } from "lucide-react";
import { GradientEdge } from "@/components/nodes/gradient-edge";
import { IconPill, Island, Pill } from "@/components/ui/pill";
import type { NodeRun } from "@/db/schema";
import {
  NODE_ORDER,
  acceptsMany,
  NODE_SPECS,
  PORT_COLOR,
  isValidEdge,
  portType,
  uniqueId,
  type CanvasGraph,
  type GraphEdge,
  type GraphNodeData,
  type NodeType,
  type PortType,
} from "@/lib/graph/types";
import type { ProjectTree } from "@/lib/projects/queries";
import { api } from "@/lib/store/api";
import { useModels } from "@/lib/store/models";
import { useProjectStore } from "@/lib/store/project-store";
import { useUiStore } from "@/lib/store/ui-store";
import { GraphContext, NodePalette, graphNodeTypes } from "./graph-nodes";
import { NODE_MIME, NodeLibrary } from "./node-library";
import { useRunner } from "./run-confirm";

const edgeTypes = { gradient: GradientEdge };

/** Leave room for the header on top, the node panel on the left and the zoom controls on the right. */
const fitOptions = (panel: boolean) => ({ padding: { top: "90px", bottom: "40px", left: panel ? "280px" : "40px", right: "80px" } }) as const;

type RfNode = Node<GraphNodeData, NodeType>;
type CanvasResponse = { graph: CanvasGraph; runs: NodeRun[]; llm: { mock: boolean; estimatedUsdPerCall: number } };
/** A link dragged from a port and dropped on empty space: the new node gets linked to it. */
type PendingLink = { nodeId: string; handleId: string; side: "source" | "target"; type: PortType };

/** First port of the new node that can take the dragged link (inputs if dragged from an output). */
function matchingPort(type: NodeType, link: PendingLink) {
  const ports = link.side === "source" ? NODE_SPECS[type].inputs : NODE_SPECS[type].outputs;
  return ports.find((p) => p.type === link.type);
}

function edgeColor(graph: CanvasGraph, e: { source: string; sourceHandle: string }) {
  const t = portType(graph, e.source, e.sourceHandle, "out");
  return t ? PORT_COLOR[t] : "var(--edge)";
}

function toFlow(graph: CanvasGraph): { nodes: RfNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: graph.edges.map((e) => ({ ...e, type: "gradient", data: { from: edgeColor(graph, e) } })),
  };
}

function fromFlow(nodes: RfNode[], edges: Edge[]): CanvasGraph {
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

/** One entry of the canvas right-click menu. */
function MenuItem({ label, icon, hint, disabled, onClick }: { label: string; icon: React.ReactNode; hint?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2 disabled:opacity-40 [&_svg]:size-3.5"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

/**
 * Canvas view: one big node canvas per project, independent of sequences.
 * The storyboard keeps its rigid pipeline; results made here can optionally be
 * sent to a shot.
 */
export function CanvasView() {
  const project = useProjectStore((s) => s.project);
  if (!project) {
    return (
      <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
        Ouvre ou crée un projet (menu du haut, ou onglet Storyboard).
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <ProjectCanvas key={project.id} project={project} />
    </ReactFlowProvider>
  );
}

function ProjectCanvas({ project }: { project: ProjectTree }) {
  const rf = useReactFlow();
  const refresh = useProjectStore((s) => s.refresh);
  const models = useModels()?.models ?? [];
  const [nodes, setNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [runs, setRuns] = useState<NodeRun[]>([]);
  const [llm, setLlm] = useState({ mock: true, estimatedUsdPerCall: 0 });
  const [loaded, setLoaded] = useState(false);
  const [palette, setPalette] = useState<{ x: number; y: number; flow: { x: number; y: number }; link?: PendingLink } | null>(null);
  const panelOpen = useUiStore((s) => s.nodePanelOpen);
  const setPanelOpen = useUiStore((s) => s.setNodePanelOpen);
  const FIT = fitOptions(panelOpen);
  /** Right-button drag: selection box (wrapper coordinates). */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Right-click menu: on the background, or on a node / the selection. */
  const [menu, setMenu] = useState<{ x: number; y: number; onNode: boolean } | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const latest = useRef({ nodes, edges });
  useEffect(() => {
    latest.current = { nodes, edges };
  }, [nodes, edges]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Undo / redo history of the graph (see `record`). */
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 });
  const url = `/api/projects/${project.id}/canvas`;

  const loadRuns = useCallback(() => api<CanvasResponse>(url).then((r) => setRuns(r.runs)), [url]);

  useEffect(() => {
    void api<CanvasResponse>(url).then((res) => {
      const flow = toFlow(res.graph);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      history.current = { stack: [JSON.stringify(res.graph)], index: 0 };
      setRuns(res.runs);
      setLlm(res.llm);
      setLoaded(true);
      // An empty canvas starts at 100 % (fitting nothing would zoom in to the max).
      setTimeout(() => (res.graph.nodes.length ? rf.fitView(FIT) : rf.setViewport({ x: panelOpen ? 300 : 80, y: 120, zoom: 1 })), 50);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Follow generations in progress (results only: never overwrite local edits).
  const pending = runs.some((r) => r.status === "queued" || r.status === "processing");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      void fetch("/api/jobs?active=1").finally(() => void loadRuns());
    }, 1500);
    return () => clearInterval(t);
  }, [pending, loadRuns]);

  const graphNow = () => fromFlow(latest.current.nodes, latest.current.edges);

  /**
   * Undo / redo: every saved state of the graph (nodes, positions, settings,
   * links) is kept, up to 100. Results are never undone (they were paid).
   */
  const record = (graph: CanvasGraph) => {
    const { stack, index } = history.current;
    const snap = JSON.stringify(graph);
    if (stack[index] === snap) return;
    const next = [...stack.slice(0, index + 1), snap].slice(-100);
    history.current = { stack: next, index: next.length - 1 };
  };

  const flush = useCallback(() => {
    const graph = fromFlow(latest.current.nodes, latest.current.edges);
    record(graph);
    return api(url, { method: "PUT", body: { graph } });
  }, [url]);

  const save = useCallback(
    (immediate = false) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (immediate) void flush();
      else saveTimer.current = setTimeout(() => void flush(), 400);
    },
    [flush],
  );

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

  /** Adds a link; several texts may feed one prompt (joined), any other input takes a single link. */
  const link = (graph: CanvasGraph, conn: Omit<GraphEdge, "id">) => {
    if (!isValidEdge(graph, conn)) return false;
    // Several texts on one prompt (joined), several reference images; other inputs take one link.
    const multiple = acceptsMany(graph, conn.target, conn.targetHandle);
    const id = `e-${conn.source}-${conn.sourceHandle}-${conn.target}-${conn.targetHandle}`;
    setEdges((es) => [
      ...es.filter((e) => e.id !== id && (multiple || !(e.target === conn.target && e.targetHandle === conn.targetHandle))),
      { ...conn, id, type: "gradient", data: { from: edgeColor(graph, conn) } },
    ]);
    return true;
  };

  /** Wiring references or an end frame switches the node to a model that accepts them (if its own does not). */
  const fitModel = (nodeId: string, handle: string) => {
    const target = latest.current.nodes.find((n) => n.id === nodeId);
    if (!target) return;
    const current = models.find((m) => m.id === target.data.modelId);
    const ok = handle === "refs" ? !!current?.maxReferenceImages : handle === "end" ? !!current?.supportsStartEndFrames : true;
    if (ok) return;
    const spec = NODE_SPECS[target.type];
    const kinds: string[] = spec.model ? [spec.model, ...(spec.altModels ?? [])] : [];
    const better =
      handle === "refs"
        ? models.find((m) => kinds.includes(m.kind) && m.maxReferenceImages)
        : models.find((m) => kinds.includes(m.kind) && m.supportsStartEndFrames);
    if (better) setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, modelId: better.id } } : n)));
  };

  const onConnect = (c: Connection) => {
    if (!c.sourceHandle || !c.targetHandle) return;
    if (link(graphNow(), { source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle })) {
      fitModel(c.target, c.targetHandle);
      setTimeout(() => save(true), 30);
    }
  };

  const addNode = (type: NodeType, at: { x: number; y: number }, from?: PendingLink, preferredModel?: string) => {
    const id = uniqueId(latest.current.nodes, type);
    const kind = NODE_SPECS[type].model;
    const modelId = preferredModel ?? (kind ? models.find((m) => m.kind === kind)?.id : undefined);
    const data: GraphNodeData = type === "text" ? { text: "" } : modelId ? { modelId } : {};
    // Dropped from an output: the node sits to the right of the cursor; from an input: to the left.
    const position = from?.side === "target" ? { x: at.x - 280, y: at.y - 30 } : from ? { x: at.x, y: at.y - 30 } : at;
    setNodes((ns) => [...ns, { id, type, position, data }]);
    const port = from && matchingPort(type, from);
    if (from && port) {
      const graph = graphNow();
      graph.nodes.push({ id, type, position, data });
      link(
        graph,
        from.side === "source"
          ? { source: from.nodeId, sourceHandle: from.handleId, target: id, targetHandle: port.id }
          : { source: id, sourceHandle: port.id, target: from.nodeId, targetHandle: from.handleId },
      );
    }
    setPalette(null);
    setTimeout(() => save(true), 30);
  };

  const openPalette = (clientX: number, clientY: number, from?: PendingLink) => {
    const box = wrapper.current?.getBoundingClientRect();
    if (!box) return;
    setPalette({
      x: Math.max(8, Math.min(clientX - box.left, box.width - 250)),
      y: Math.max(8, Math.min(clientY - box.top, box.height - 380)),
      flow: rf.screenToFlowPosition({ x: clientX, y: clientY }),
      link: from,
    });
  };

  /** A link dropped on empty space proposes the nodes that can take it. */
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || state.toHandle || !state.fromHandle?.id || !state.fromNode) return;
    const side = state.fromHandle.type;
    const type = portType(graphNow(), state.fromNode.id, state.fromHandle.id, side === "source" ? "out" : "in");
    if (!type) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    openPalette(point.clientX, point.clientY, { nodeId: state.fromNode.id, handleId: state.fromHandle.id, side, type });
  };

  // --- selection ------------------------------------------------------------------

  const selectedIds = () => latest.current.nodes.filter((n) => n.selected).map((n) => n.id);
  const selectAll = () => setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
  const clearSelection = () => setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));

  /** Copies of the given nodes (+ the links between them), shifted, and selected. Results stay with the originals. */
  const duplicate = (ids: string[]) => {
    if (!ids.length) return;
    const all = [...latest.current.nodes];
    const map = new Map<string, string>();
    const copies: RfNode[] = [];
    for (const n of all.filter((x) => ids.includes(x.id))) {
      const id = uniqueId([...all, ...copies], n.type as NodeType);
      map.set(n.id, id);
      const data = structuredClone(n.data);
      delete data.selectedRunId;
      copies.push({ id, type: n.type, position: { x: n.position.x + 40, y: n.position.y + 40 }, data, selected: true });
    }
    const graph = graphNow();
    const newEdges = latest.current.edges
      .filter((e) => map.has(e.source) && map.has(e.target))
      .map((e) => {
        const conn = { source: map.get(e.source)!, sourceHandle: e.sourceHandle ?? "", target: map.get(e.target)!, targetHandle: e.targetHandle ?? "" };
        return {
          ...conn,
          id: `e-${conn.source}-${conn.sourceHandle}-${conn.target}-${conn.targetHandle}`,
          type: "gradient",
          data: { from: edgeColor(graph, { source: e.source, sourceHandle: e.sourceHandle ?? "" }) },
        };
      });
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copies]);
    setEdges((es) => [...es, ...newEdges]);
    setTimeout(() => save(true), 30);
  };

  const removeSelected = () => {
    const ids = selectedIds();
    if (!ids.length) return;
    void rf.deleteElements({ nodes: ids.map((id) => ({ id })) }).then(() => setTimeout(() => save(true), 30));
  };

  /** Adds a node from the library: at the drop point, or in the middle of the view. */
  const addFromLibrary = (type: NodeType, clientX?: number, clientY?: number, modelId?: string) => {
    const r = wrapper.current?.getBoundingClientRect();
    if (!r) return;
    const x = clientX ?? r.left + r.width / 2 + (panelOpen ? 120 : 0);
    const y = clientY ?? r.top + r.height / 2;
    const at = rf.screenToFlowPosition({ x, y });
    addNode(type, { x: at.x - 130, y: at.y - 40 }, undefined, modelId);
  };

  /** Moves through the history and saves the restored state (without recording it again). */
  const travel = (step: -1 | 1) => {
    // A change still waiting to be saved is recorded first, so it can be undone too.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      record(graphNow());
    }
    const { stack, index } = history.current;
    const next = index + step;
    if (next < 0 || next >= stack.length) return;
    history.current = { stack, index: next };
    const graph = JSON.parse(stack[next]) as CanvasGraph;
    const flow = toFlow(graph);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setMenu(null);
    setPalette(null);
    void api(url, { method: "PUT", body: { graph } });
  };

  // Keyboard: Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Ctrl+Y redo, Cmd/Ctrl+A select all,
  // Cmd/Ctrl+D duplicate, Escape clear. Inside a text field, the field's own undo applies.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest?.("input, textarea, select, [contenteditable=true]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        travel(e.shiftKey ? 1 : -1);
      } else if (mod && key === "y") {
        e.preventDefault();
        travel(1);
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate(selectedIds());
      } else if (e.key === "Escape") {
        setMenu(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** After a box selection, the click that ends a Ctrl+click drag must not clear it. */
  const swallowClick = useRef(false);

  /** Opens the right-click menu at a screen point, kept inside the canvas near its edges. */
  const openMenu = (clientX: number, clientY: number, onNode: boolean, selected: number) => {
    const r = wrapper.current!.getBoundingClientRect();
    const h = selected > 0 ? 210 : 90;
    setMenu({
      x: Math.max(8, Math.min(clientX - r.left, r.width - 236)),
      y: Math.max(8, Math.min(clientY - r.top, r.height - h)),
      onNode,
    });
  };

  /** Right button on the background: drag = selection box, click = menu. */
  const onRightDown = (e: React.PointerEvent) => {
    // Right button, or Ctrl+click (how a Mac often right-clicks).
    const right = e.button === 2 || (e.button === 0 && e.ctrlKey && !e.metaKey);
    if (!right) return;
    const t = e.target as HTMLElement;
    // Anywhere on the background (edges included), never on a node, a port or a panel.
    if (!t.closest(".react-flow") || t.closest(".react-flow__node, .react-flow__handle, .island, button, input, textarea, select")) return;
    e.preventDefault();
    e.stopPropagation();
    const r = wrapper.current!.getBoundingClientRect();
    const start = { x: e.clientX - r.left, y: e.clientY - r.top };
    const additive = e.shiftKey;
    let moved = false;
    setMenu(null);
    const move = (ev: PointerEvent) => {
      const cur = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      if (Math.abs(cur.x - start.x) + Math.abs(cur.y - start.y) > 4) moved = true;
      if (moved) setBox({ x0: start.x, y0: start.y, x1: cur.x, y1: cur.y });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBox(null);
      if (!moved) {
        openMenu(ev.clientX, ev.clientY, false, latest.current.nodes.filter((n) => n.selected).length);
        return;
      }
      const a = rf.screenToFlowPosition({ x: Math.min(start.x, ev.clientX - r.left) + r.left, y: Math.min(start.y, ev.clientY - r.top) + r.top });
      const b = rf.screenToFlowPosition({ x: Math.max(start.x, ev.clientX - r.left) + r.left, y: Math.max(start.y, ev.clientY - r.top) + r.top });
      const inside = new Set(
        rf
          .getNodes()
          .filter((n) => {
            const w = n.measured?.width ?? 260;
            const h = n.measured?.height ?? 120;
            return n.position.x < b.x && n.position.x + w > a.x && n.position.y < b.y && n.position.y + h > a.y;
          })
          .map((n) => n.id),
      );
      setNodes((ns) => ns.map((n) => ({ ...n, selected: inside.has(n.id) || (additive && !!n.selected) })));
      swallowClick.current = true;
      setTimeout(() => (swallowClick.current = false), 300);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const selectedCount = nodes.filter((n) => n.selected).length;

  const ctx = {
    project,
    models,
    runs,
    llm,
    updateData,
    inputText: (nodeId: string) =>
      edges
        .filter((e) => e.target === nodeId && e.targetHandle === "prompt")
        .map((e) => {
          const src = nodes.find((n) => n.id === e.source);
          // A reference brings its descriptor, word for word.
          if (src?.type === "reference") return project.references.find((r) => r.id === src.data.referenceId)?.descriptor.trim() ?? "";
          return src?.data.text?.trim() ?? "";
        })
        .filter(Boolean)
        .join("\n\n"),
    wired: (nodeId: string, handle: string) => edges.some((e) => e.target === nodeId && e.targetHandle === handle),
    // Saved graph first, then the LLM; the result lands in the node (and downstream).
    enhance: async (nodeId: string) => {
      await flush();
      const r = await api<{ text: string; source: string }>(`/api/projects/${project.id}/canvas/enhance`, { body: { nodeId } });
      setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, text: r.text, source: r.source } } : n)));
    },
    // Run on the saved graph: flush edits first.
    run: (nodeId: string, variants: number) => void flush().then(() => run({ projectId: project.id, nodeId, variants })),
    sendToShot: (runId: string, shotId: string) =>
      void api(`/api/node-runs/${runId}/send`, { body: { shotId } }).then(() => {
        void loadRuns();
        void refresh();
      }),
    upload: (nodeId: string, file: File) => {
      const form = new FormData();
      form.append("files", file);
      void fetch("/api/assets", { method: "POST", body: form })
        .then((r) => r.json())
        .then((assets: { id: string }[]) => Array.isArray(assets) && assets[0] && updateData(nodeId, { assetId: assets[0].id }));
    },
  };

  return (
    <GraphContext.Provider value={ctx}>
      <div
        ref={wrapper}
        className="relative flex-1"
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) openPalette(e.clientX, e.clientY);
        }}
        onPointerDownCapture={onRightDown}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(NODE_MIME)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          // "type" or "type|modelId" (a model dragged from the Models tab).
          const [type, modelId] = e.dataTransfer.getData(NODE_MIME).split("|") as [NodeType, string | undefined];
          if (type && NODE_SPECS[type]) {
            e.preventDefault();
            addFromLibrary(type, e.clientX + 130, e.clientY + 40, modelId || undefined);
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
            onConnectEnd={onConnectEnd}
            onNodeDragStop={() => save()}
            onNodesDelete={() => setTimeout(() => save(true), 30)}
            onEdgesDelete={() => setTimeout(() => save(true), 30)}
            onPaneClick={() => {
              setPalette(null);
              setMenu(null);
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              // Right-click on an unselected node selects it alone.
              if (!n.selected) setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === n.id })));
              openMenu(e.clientX, e.clientY, true, n.selected ? latest.current.nodes.filter((x) => x.selected).length : 1);
            }}
            onSelectionContextMenu={(e) => {
              e.preventDefault();
              openMenu(e.clientX, e.clientY, true, latest.current.nodes.filter((x) => x.selected).length);
            }}
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

        <div className="pointer-events-none absolute top-3 right-4 left-4 z-10 flex items-start gap-2">
          <Island className="pointer-events-auto">
            <span className="px-2 text-xs">Canvas du projet</span>
            <Pill onClick={(e) => openPalette(e.clientX, e.clientY + 24)}>
              <Plus /> Node
            </Pill>
          </Island>
          <p className="mt-2.5 ml-auto text-right text-[10px] text-muted-foreground">
            Clic droit + glisser : sélectionner · clic droit : menu · ⌘Z annuler · ⌘⇧Z rétablir · ⌘A tout · ⌘D dupliquer · Suppr : effacer
          </p>
        </div>

        <NodeLibrary open={panelOpen} onToggle={() => setPanelOpen(!panelOpen)} onAdd={(type, modelId) => addFromLibrary(type, undefined, undefined, modelId)} />

        {box && (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-port-image/80 bg-port-image/10"
            style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
          />
        )}

        {menu && (
          <div
            className="island absolute z-30 w-56 p-1"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            role="menu"
          >
            {!menu.onNode && (
              <MenuItem
                label="Ajouter un node ici…"
                icon={<Plus />}
                onClick={() => {
                  const r = wrapper.current!.getBoundingClientRect();
                  setMenu(null);
                  openPalette(menu.x + r.left, menu.y + r.top);
                }}
              />
            )}
            <MenuItem label="Tout sélectionner" icon={<BoxSelect />} hint="⌘A" disabled={nodes.length === 0} onClick={() => (setMenu(null), selectAll())} />
            {selectedCount > 0 && (
              <>
                <div className="my-1 border-t" />
                <div className="px-2 pb-0.5 text-[10px] text-muted-foreground">
                  {selectedCount} node{selectedCount > 1 ? "s" : ""} sélectionné{selectedCount > 1 ? "s" : ""}
                </div>
                <MenuItem label="Dupliquer" icon={<Copy />} hint="⌘D" onClick={() => (setMenu(null), duplicate(selectedIds()))} />
                <MenuItem label="Supprimer" icon={<Trash2 />} hint="Suppr" onClick={() => (setMenu(null), removeSelected())} />
                <MenuItem label="Désélectionner" icon={<X />} hint="Échap" onClick={() => (setMenu(null), clearSelection())} />
              </>
            )}
          </div>
        )}

        {loaded && nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
            <div className="island pointer-events-auto w-96 p-4 text-center">
              <p className="mb-1 text-sm">Canvas vide</p>
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                Construis ton workflow librement, sans séquence ni plan : ajoute des nodes puis relie leurs ports. Un résultat peut
                ensuite être envoyé à un plan du storyboard, si tu veux.
              </p>
              <div className="flex flex-wrap justify-center gap-1">
                {(["text", "textToImage", "imageToVideo"] as const).map((t, i) => (
                  <Pill key={t} className="h-7 text-[11px]" onClick={() => addNode(t, { x: i * 340, y: 0 })}>
                    <Plus /> {NODE_SPECS[t].label}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        )}

        <Island className="absolute top-1/2 right-4 z-10 -translate-y-1/2 flex-col">
          <IconPill className="bg-transparent" aria-label="Zoom avant" onClick={() => rf.zoomIn()}>
            <Plus />
          </IconPill>
          <IconPill className="bg-transparent" aria-label="Zoom arrière" onClick={() => rf.zoomOut()}>
            <Minus />
          </IconPill>
          <IconPill className="bg-transparent" aria-label="Ajuster" onClick={() => rf.fitView(FIT)}>
            <Grid2x2 />
          </IconPill>
          <IconPill className="bg-transparent" aria-label="Recentrer" onClick={() => rf.fitView({ ...FIT, maxZoom: 0.8 })}>
            <Crosshair />
          </IconPill>
        </Island>

        {palette && (
          <NodePalette
            x={palette.x}
            y={palette.y}
            types={palette.link ? NODE_ORDER.filter((t) => matchingPort(t, palette.link!)) : undefined}
            title={palette.link ? (palette.link.side === "source" ? "Brancher la sortie sur…" : "Alimenter l'entrée avec…") : undefined}
            onClose={() => setPalette(null)}
            onPick={(type) => addNode(type, palette.flow, palette.link)}
          />
        )}
        {dialog}
      </div>
    </GraphContext.Provider>
  );
}
