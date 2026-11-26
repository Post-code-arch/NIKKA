import { randomInt } from "node:crypto";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NodeRun, Take } from "@/db/schema";
import { generateImage, generateVideo, uploadMedia } from "@/lib/atlas";
import { isMockMode } from "@/lib/atlas/config";
import { callJson } from "@/lib/digester/llm";
import { estimateLlmUsd } from "@/lib/digester/service";
import { z } from "zod";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd, round } from "@/lib/cost/estimate";
import { GenerationError } from "@/lib/generation/service";
import { ensurePoller, refreshShotStatus } from "@/lib/jobs/poller";
import { availableModels, getModel } from "@/lib/models/registry";
import type { GenericInputs, ModelEntry } from "@/lib/models/types";
import { CanvasGraphSchema, NODE_SPECS, incoming, isValidEdge, sanitizeGraph, type CanvasGraph, type GraphNode } from "./types";

/**
 * The project canvas: one free node graph per project, independent of
 * sequences and shots. Running a generator records NodeRuns; a result can
 * optionally be sent to any shot of the storyboard, where it becomes a Take.
 */

const DEFAULT_DURATION_SEC = 5;

function loadProject(projectId: string) {
  const project = getDb().select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) throw new GenerationError("Projet introuvable", 404);
  return project;
}

export function nodeRunsOf(projectId: string): NodeRun[] {
  return getDb().select().from(schema.nodeRuns).where(eq(schema.nodeRuns.projectId, projectId)).orderBy(desc(schema.nodeRuns.createdAt)).all();
}

/** The project's canvas (empty until the user adds nodes) and its results. */
export function getCanvas(projectId: string) {
  const project = loadProject(projectId);
  return {
    graph: sanitizeGraph(project.canvas),
    runs: nodeRunsOf(projectId),
    llm: { mock: isMockMode(), estimatedUsdPerCall: estimateLlmUsd(1000) },
  };
}

/** Validates and stores an edited canvas. */
export function writeGraph(projectId: string, input: unknown): CanvasGraph {
  loadProject(projectId);
  const graph = CanvasGraphSchema.parse(input);
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) throw new GenerationError("Identifiants de nodes en double", 400);
  if (graph.edges.some((e) => !isValidEdge(graph, e))) {
    throw new GenerationError("Lien invalide : les deux ports doivent porter le même type", 400);
  }
  getDb().update(schema.projects).set({ canvas: graph }).where(eq(schema.projects.id, projectId)).run();
  return graph;
}

// --- input resolution ----------------------------------------------------------

/** The result a generator passes downstream: the chosen one, else the latest completed. */
export function selectedRun(node: GraphNode, runs: NodeRun[]): NodeRun | undefined {
  const mine = runs.filter((r) => r.nodeId === node.id && r.status === "completed" && r.assetId);
  return mine.find((r) => r.id === node.data.selectedRunId) ?? mine[0];
}

/** Asset carried by a node's output (imported file or selected result). */
export function assetOf(node: GraphNode, runs: NodeRun[]): string | undefined {
  if (node.type === "image" || node.type === "video") return node.data.assetId;
  if (NODE_SPECS[node.type].model) return selectedRun(node, runs)?.assetId ?? undefined;
  return undefined;
}

/** Text arriving on a node's prompt input (several links are joined in link order). */
export function incomingText(graph: CanvasGraph, node: GraphNode): string {
  return incoming(graph, node.id, "prompt")
    .map((s) => s.data.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function resolvePrompt(graph: CanvasGraph, gen: GraphNode): string {
  const sources = incoming(graph, gen.id, "prompt");
  if (sources.length === 0) throw new GenerationError("Branche un node Texte sur l'entrée prompt", 400);
  const pending = sources.find((s) => s.type === "promptEnhancer" && !s.data.text?.trim());
  if (pending) throw new GenerationError("Le prompt enhancer branché n'a pas encore été lancé : clique sur « Améliorer »", 400);
  // Several Text nodes on the same input are joined in link order.
  const text = sources
    .map((s) => s.data.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
  if (!text) throw new GenerationError("Le node Texte branché est vide", 400);
  return text;
}

async function uploadAsset(id: string): Promise<string> {
  const asset = getDb().select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  if (!asset) throw new GenerationError("Fichier introuvable", 404);
  return uploadMedia(path.resolve(asset.path));
}

// --- running -------------------------------------------------------------------

export interface RunOptions {
  nodeId: string;
  variants?: number;
  confirmedCostUsd?: number;
  estimateOnly?: boolean;
}

export interface RunEstimate {
  nodeId: string;
  modelId: string;
  variants: number;
  unitCostUsd: number;
  costEstimatedUsd: number;
  thresholdUsd: number;
  needsConfirmation: boolean;
}

export function nodeModel(node: GraphNode): ModelEntry {
  const kind = NODE_SPECS[node.type].model;
  if (!kind) throw new GenerationError("Ce node ne génère rien", 400);
  const model = node.data.modelId ? getModel(node.data.modelId) : undefined;
  const chosen = model?.kind === kind ? model : availableModels(kind)[0];
  if (!chosen) throw new GenerationError("Aucun modèle disponible pour ce node", 400);
  return chosen;
}

function findGenNode(graph: CanvasGraph, nodeId: string): GraphNode {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n) throw new GenerationError("Node introuvable", 404);
  if (!NODE_SPECS[n.type].model) throw new GenerationError("Ce node ne génère rien", 400);
  return n;
}

function durationOf(node: GraphNode, model: ModelEntry): number | undefined {
  if (model.endpoint !== "generateVideo") return undefined;
  return node.data.durationSec ?? model.durations?.[0] ?? DEFAULT_DURATION_SEC;
}

export function estimateRun(projectId: string, opts: RunOptions): RunEstimate {
  const project = loadProject(projectId);
  const node = findGenNode(sanitizeGraph(project.canvas), opts.nodeId);
  const model = nodeModel(node);
  const variants = Math.min(8, Math.max(1, opts.variants ?? 1));
  const unit = estimateCostUsd(model, { seconds: durationOf(node, model) ?? DEFAULT_DURATION_SEC });
  const total = round(unit * variants);
  const threshold = project.settings.confirmThresholdUsd ?? DEFAULT_CONFIRM_THRESHOLD_USD;
  return {
    nodeId: node.id,
    modelId: model.id,
    variants,
    unitCostUsd: unit,
    costEstimatedUsd: total,
    thresholdUsd: threshold,
    // Any batch (variants) needs a confirmation (PRD §11).
    needsConfirmation: total > threshold || variants > 1,
  };
}

/** Runs one generator ×variants. Never retried; each variant is a new result. */
export async function runNode(projectId: string, opts: RunOptions): Promise<{ estimate: RunEstimate; runs: NodeRun[] }> {
  const estimate = estimateRun(projectId, opts);
  if (opts.estimateOnly) return { estimate, runs: [] };
  if (estimate.needsConfirmation && (opts.confirmedCostUsd ?? -1) < estimate.costEstimatedUsd) {
    throw new GenerationError("Confirmation du coût requise", 409, { ...estimate });
  }
  const db = getDb();
  const project = loadProject(projectId);
  const graph = sanitizeGraph(project.canvas);
  const node = findGenNode(graph, opts.nodeId);
  const model = nodeModel(node);
  const prompt = resolvePrompt(graph, node);
  const generic: GenericInputs = { prompt, durationSec: durationOf(node, model) };

  if (node.type === "imageToVideo") {
    const start = incoming(graph, node.id, "image")[0];
    const startId = start ? assetOf(start, nodeRunsOf(projectId)) : undefined;
    if (!startId) throw new GenerationError("Il faut une image de départ : branche un node Image ou une image générée", 400);
    generic.startImageUrl = await uploadAsset(startId);
  }

  // Seeds: locked = base, base+1… so variants stay comparable; else random.
  let base = node.data.seed;
  if (node.data.seedLocked && base === undefined) {
    base = randomInt(1, 2 ** 31 - 1);
    node.data.seed = base;
    db.update(schema.projects).set({ canvas: graph }).where(eq(schema.projects.id, projectId)).run();
  }

  const created: NodeRun[] = [];
  for (let i = 0; i < estimate.variants; i++) {
    const seed = model.supportsSeed ? (node.data.seedLocked && base !== undefined ? base + i : randomInt(1, 2 ** 31 - 1)) : undefined;
    const body = { model: model.id, ...model.mapInputs({ ...generic, seed }) };
    const run = db
      .insert(schema.nodeRuns)
      .values({
        projectId,
        nodeId: node.id,
        kind: model.endpoint === "generateVideo" ? "video" : "image",
        model: model.id,
        prompt,
        params: body,
        seed,
        status: "queued",
        costEstimatedUsd: estimate.unitCostUsd,
      })
      .returning()
      .get();
    try {
      const sub = model.endpoint === "generateImage" ? await generateImage(body) : await generateVideo(body);
      db.update(schema.nodeRuns).set({ predictionId: sub.predictionId }).where(eq(schema.nodeRuns.id, run.id)).run();
      db.insert(schema.jobs).values({ nodeRunId: run.id, predictionId: sub.predictionId, endpoint: sub.endpoint }).run();
    } catch (err) {
      db.update(schema.nodeRuns)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(schema.nodeRuns.id, run.id))
        .run();
    }
    created.push(db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.id, run.id)).get()!);
  }
  ensurePoller();
  return { estimate, runs: created };
}

/**
 * Optional link to the storyboard: sends a canvas result to a shot of the same
 * project, where it becomes a take (cost already counted on the run).
 * Sending the same result to the same shot again returns the existing take.
 */
export function sendToShot(runId: string, shotId: string): Take {
  const db = getDb();
  const run = db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.id, runId)).get();
  if (!run) throw new GenerationError("Résultat introuvable", 404);
  if (run.status !== "completed" || !run.assetId) throw new GenerationError("Ce résultat n'est pas terminé", 400);
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get();
  if (!shot) throw new GenerationError("Plan introuvable", 404);
  const sequence = db.select().from(schema.sequences).where(eq(schema.sequences.id, shot.sequenceId)).get();
  if (sequence?.projectId !== run.projectId) throw new GenerationError("Ce plan appartient à un autre projet", 400);

  if (run.sentTakeId && run.shotId === shotId) {
    const existing = db.select().from(schema.takes).where(eq(schema.takes.id, run.sentTakeId)).get();
    if (existing) return existing;
  }
  const take = db
    .insert(schema.takes)
    .values({
      shotId,
      stage: run.kind === "video" ? "video" : "keyframe",
      assetId: run.assetId,
      nodeId: run.nodeId,
      model: run.model,
      prompt: run.prompt,
      params: run.params,
      seed: run.seed,
      predictionId: run.predictionId,
      status: "completed",
      costEstimatedUsd: 0,
      costActualUsd: 0,
    })
    .returning()
    .get();
  // Remembers the last shot it was sent to.
  db.update(schema.nodeRuns).set({ sentTakeId: take.id, shotId }).where(eq(schema.nodeRuns.id, run.id)).run();
  refreshShotStatus(shotId);
  return take;
}

// --- prompt enhancer (LLM) ---------------------------------------------------------------

const EnhanceSchema = z.object({ prompt: z.string().trim().min(1).max(4000) });

/**
 * Runs a Prompt enhancer node: the LLM rewrites the text on its input. The
 * result is stored in the node (editable) and flows to its output.
 */
export async function enhanceNode(projectId: string, nodeId: string) {
  const project = loadProject(projectId);
  const graph = sanitizeGraph(project.canvas);
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "promptEnhancer") throw new GenerationError("Ce node n'est pas un prompt enhancer", 400);
  const source = incomingText(graph, node);
  if (!source) throw new GenerationError("Branche un node Texte (non vide) sur l'entrée prompt", 400);
  const target = node.data.target ?? "image";
  const instruction = node.data.instruction?.trim() ?? "";
  const { prompt } = await callJson(
    "enhance",
    EnhanceSchema,
    { brief: source, context: { target, instruction } },
    { target, instruction: instruction || "none" },
  );
  // Re-read: the canvas may have been edited while the LLM answered.
  const latest = sanitizeGraph(loadProject(projectId).canvas);
  const current = latest.nodes.find((n) => n.id === nodeId);
  if (current) {
    current.data = { ...current.data, text: prompt, source };
    getDb().update(schema.projects).set({ canvas: latest }).where(eq(schema.projects.id, projectId)).run();
  }
  return { text: prompt, source };
}
