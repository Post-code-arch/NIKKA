import { randomInt } from "node:crypto";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { NodeRun, Shot, Take } from "@/db/schema";
import { generateImage, generateVideo, uploadMedia } from "@/lib/atlas";
import { cameraPhrase } from "@/lib/camera/phrasing";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd, round } from "@/lib/cost/estimate";
import { GenerationError } from "@/lib/generation/service";
import { ensurePoller, refreshShotStatus } from "@/lib/jobs/poller";
import { extractFrame } from "@/lib/media/frame";
import { availableModels, getModel } from "@/lib/models/registry";
import type { GenericInputs, ModelEntry, ModelKind } from "@/lib/models/types";
import { buildPrompt } from "@/lib/prompt/build";
import { buildRecipeGraph, refIdsFromGraph, syncReferenceNodes, type RecipeId } from "@/lib/recipes";
import { selectReferenceViews } from "@/lib/refs/select";
import { NODE_SPECS, ShotGraphSchema, incoming, isValidEdge, type GraphNode, type ShotGraphData } from "./types";

/**
 * Free canvas of a shot (one per shot). The user builds the graph; running a
 * generation node resolves its inputs and records NodeRuns. Results stay in
 * the canvas until sent to the shot, which creates a storyboard Take.
 */

function loadShot(shotId: string) {
  const db = getDb();
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get();
  if (!shot) throw new GenerationError("Plan introuvable", 404);
  const sequence = db.select().from(schema.sequences).where(eq(schema.sequences.id, shot.sequenceId)).get()!;
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, sequence.projectId)).get()!;
  return { shot, sequence, project };
}

function firstModel(kind: ModelKind, preferred?: string | null): string | null {
  const list = availableModels(kind);
  return list.find((m) => m.id === preferred)?.id ?? list[0]?.id ?? null;
}

/** Default models of a project per role (text→image, multi-ref edit, image→video). */
export function projectModels(settings: { defaultModels: Record<string, string> }) {
  const d = settings.defaultModels;
  const kf = d.keyframe ? getModel(d.keyframe) : undefined;
  return {
    t2i: firstModel("t2i", kf?.kind === "t2i" ? kf.id : d.t2i),
    i2i: firstModel("i2i", kf?.kind === "i2i" ? kf.id : d.i2i),
    i2v: firstModel("i2v", d.video),
  };
}

export function readGraph(shot: Shot): ShotGraphData {
  const parsed = ShotGraphSchema.safeParse(shot.graph);
  if (!parsed.success) return { nodes: [], edges: [] };
  // Graphs saved by earlier versions may hold links to ports that no longer exist.
  return { nodes: parsed.data.nodes, edges: parsed.data.edges.filter((e) => isValidEdge(parsed.data, e)) };
}

function saveGraph(shotId: string, graph: ShotGraphData) {
  // Bible references placed in the canvas are also the shot's references.
  const db = getDb();
  const shot = db.select().from(schema.shots).where(eq(schema.shots.id, shotId)).get()!;
  const inGraph = refIdsFromGraph(graph);
  const refIds = [...new Set([...shot.refIds.filter((id) => inGraph.includes(id) || !hadInGraph(shot, id)), ...inGraph])];
  db.update(schema.shots).set({ graph, refIds }).where(eq(schema.shots.id, shotId)).run();
}

/** A ref removed from the canvas leaves the shot only if it was in the canvas before. */
function hadInGraph(shot: Shot, refId: string) {
  return refIdsFromGraph(readGraph(shot)).includes(refId);
}

function shotRefs(refIds: string[]) {
  if (refIds.length === 0) return [];
  const rows = getDb().select().from(schema.references).where(inArray(schema.references.id, refIds)).all();
  return refIds.map((id) => rows.find((r) => r.id === id)).filter((r) => !!r);
}

export function nodeRunsOf(shotId: string): NodeRun[] {
  return getDb().select().from(schema.nodeRuns).where(eq(schema.nodeRuns.shotId, shotId)).orderBy(desc(schema.nodeRuns.createdAt)).all();
}

/** The shot's canvas (empty until the user adds nodes or a template) and its results. */
export function getCanvas(shotId: string) {
  const { shot } = loadShot(shotId);
  return { graph: readGraph(shot), runs: nodeRunsOf(shotId) };
}

/** Validates and stores an edited canvas. */
export function writeGraph(shotId: string, input: unknown) {
  loadShot(shotId);
  const graph = ShotGraphSchema.parse(input);
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length) throw new GenerationError("Identifiants de nodes en double", 400);
  const bad = graph.edges.find((e) => !isValidEdge(graph, e));
  if (bad) throw new GenerationError("Lien invalide : les deux ports doivent porter le même type", 400);
  saveGraph(shotId, graph);
  return graph;
}

/** Inserts a recipe template next to the existing nodes. */
export function insertTemplate(shotId: string, recipe: RecipeId, origin = { x: 0, y: 0 }) {
  const { shot, project } = loadShot(shotId);
  const graph = readGraph(shot);
  const refs = shotRefs(shot.refIds);
  const added = buildRecipeGraph(recipe, refs.map((r) => ({ id: r.id, tag: r.tag })), projectModels(project.settings), graph.nodes, origin);
  const next = { nodes: [...graph.nodes, ...added.nodes], edges: [...graph.edges, ...added.edges] };
  saveGraph(shotId, next);
  return next;
}

/** The shot's refIds changed in the storyboard sheet: mirror them on Reference nodes already in the canvas. */
export function syncGraphRefs(shotId: string) {
  const { shot } = loadShot(shotId);
  const graph = readGraph(shot);
  if (!graph.nodes.some((n) => n.type === "reference")) return;
  getDb()
    .update(schema.shots)
    .set({ graph: syncReferenceNodes(graph, shot.refIds) })
    .where(eq(schema.shots.id, shotId))
    .run();
}

// --- input resolution ----------------------------------------------------------

function refsOn(graph: ShotGraphData, node: GraphNode, handle: string) {
  const ids = incoming(graph, node.id, handle)
    .filter((n) => n.type === "reference" && n.data.referenceId)
    .map((n) => n.data.referenceId!);
  return shotRefs([...new Set(ids)]);
}

export function resolvePrompt(shot: Shot, graph: ShotGraphData, gen: GraphNode, model: ModelEntry): string {
  const source = incoming(graph, gen.id, "prompt")[0];
  if (!source) throw new GenerationError("Branche un node Texte ou Prompt du plan sur l'entrée prompt", 400);
  if (source.type === "text") {
    const text = source.data.text?.trim();
    if (!text) throw new GenerationError("Le node Texte est vide", 400);
    return text;
  }
  if (source.type !== "promptBuilder") throw new GenerationError("Entrée prompt non prise en charge", 400);
  const refs = refsOn(graph, source, "refs");
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  const stage = NODE_SPECS[gen.type].generates === "video" ? "video" : "keyframe";
  return buildPrompt({
    descriptors: refs.filter((r) => r.tag !== "look").map((r) => ({ name: r.name, descriptor: r.descriptor })),
    action: source.data.override?.trim() || shot.description.value,
    camera: cameraPhrase(stage, camera, model.camera),
    looks: refs.filter((r) => r.tag === "look").map((r) => ({ name: r.name, descriptor: r.descriptor })),
  }).prompt;
}

/** Views chosen by a RefSelector (automatic for the shot scale, or manual). */
export function selectorViews(shot: Shot, graph: ShotGraphData, selector: GraphNode, maxSlots: number) {
  if (selector.data.manualViews?.length) return selector.data.manualViews;
  const refs = refsOn(graph, selector, "refs");
  const variants = refs.length
    ? getDb().select().from(schema.referenceVariants).where(inArray(schema.referenceVariants.referenceId, refs.map((r) => r.id))).all()
    : [];
  return selectReferenceViews(
    refs.map((r) => ({ id: r.id, name: r.name, tag: r.tag, views: variants.find((v) => v.referenceId === r.id)?.views ?? [] })),
    shot.camera?.value ?? DEFAULT_CAMERA,
    maxSlots,
  ).picked.map((p) => p.assetId);
}

/** Takes of the shot in the storyboard for a stage, newest first. */
export function takesForStage(shotId: string, stage: "keyframe" | "video"): Take[] {
  const stages = stage === "video" ? (["video"] as const) : (["keyframe", "sketch"] as const);
  return getDb()
    .select()
    .from(schema.takes)
    .where(and(eq(schema.takes.shotId, shotId), inArray(schema.takes.stage, [...stages])))
    .orderBy(desc(schema.takes.createdAt))
    .all();
}

/** The storyboard's retained take for a stage (else the latest completed one). */
export function retainedTake(shot: Shot, stage: "keyframe" | "video"): Take | undefined {
  const list = takesForStage(shot.id, stage).filter((t) => t.status === "completed");
  return list.find((t) => t.id === shot.selectedTakeId) ?? list[0];
}

/** The result a generation node passes downstream: the chosen one, else the latest completed. */
export function selectedRun(node: GraphNode, runs: NodeRun[]): NodeRun | undefined {
  const mine = runs.filter((r) => r.nodeId === node.id && r.status === "completed" && r.assetId);
  return mine.find((r) => r.id === node.data.selectedRunId) ?? mine[0];
}

function previousShotVideo(shot: Shot): Take | undefined {
  const siblings = getDb().select().from(schema.shots).where(eq(schema.shots.sequenceId, shot.sequenceId)).orderBy(asc(schema.shots.order)).all();
  const prev = siblings[siblings.findIndex((s) => s.id === shot.id) - 1];
  return prev ? retainedTake(prev, "video") : undefined;
}

/** Asset carried by a node's output (image or video). */
async function assetOf(shot: Shot, graph: ShotGraphData, node: GraphNode, runs: NodeRun[]): Promise<string | undefined> {
  switch (node.type) {
    case "imageInput":
      return node.data.assetId;
    case "imageGen":
    case "imageEdit":
    case "videoGen":
      return selectedRun(node, runs)?.assetId ?? undefined;
    case "take":
      return retainedTake(shot, node.data.stage === "video" ? "video" : "keyframe")?.assetId ?? undefined;
    case "frameExtract": {
      let video: string | undefined;
      if (node.data.source === "previous_shot") video = previousShotVideo(shot)?.assetId ?? undefined;
      else {
        const upstream = incoming(graph, node.id, "video")[0];
        if (upstream) video = await assetOf(shot, graph, upstream, runs);
      }
      if (!video) return undefined;
      const asset = getDb().select().from(schema.assets).where(eq(schema.assets.id, video)).get();
      if (!asset || asset.kind !== "video") return undefined;
      return (await extractFrame(asset, node.data.which ?? "last")).id;
    }
    default:
      return undefined;
  }
}

async function uploadAssets(ids: string[]): Promise<string[]> {
  const urls: string[] = [];
  for (const id of ids) {
    const asset = getDb().select().from(schema.assets).where(eq(schema.assets.id, id)).get();
    if (asset) urls.push(await uploadMedia(path.resolve(asset.path)));
  }
  return urls;
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

function nodeModel(node: GraphNode): ModelEntry {
  const kind: ModelKind = node.type === "imageEdit" ? "i2i" : node.type === "videoGen" ? "i2v" : "t2i";
  const model = node.data.modelId ? getModel(node.data.modelId) : undefined;
  const chosen = model?.kind === kind ? model : availableModels(kind)[0];
  if (!chosen) throw new GenerationError("Aucun modèle disponible pour ce node", 400);
  return chosen;
}

function findGenNode(graph: ShotGraphData, nodeId: string): GraphNode {
  const n = graph.nodes.find((x) => x.id === nodeId);
  if (!n || !NODE_SPECS[n.type].generates) throw new GenerationError("Ce node ne génère rien", 400);
  return n;
}

export function estimateRun(shotId: string, opts: RunOptions): RunEstimate {
  const { shot, project } = loadShot(shotId);
  const node = findGenNode(readGraph(shot), opts.nodeId);
  const model = nodeModel(node);
  const variants = Math.min(8, Math.max(1, opts.variants ?? 1));
  const unit = estimateCostUsd(model, { seconds: shot.durationSec });
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

/** Runs one generation node ×variants. Never retried; each variant is a new result. */
export async function runNode(shotId: string, opts: RunOptions): Promise<{ estimate: RunEstimate; runs: NodeRun[] }> {
  const estimate = estimateRun(shotId, opts);
  if (opts.estimateOnly) return { estimate, runs: [] };
  if (estimate.needsConfirmation && (opts.confirmedCostUsd ?? -1) < estimate.costEstimatedUsd) {
    throw new GenerationError("Confirmation du coût requise", 409, { ...estimate });
  }
  const db = getDb();
  const { shot } = loadShot(shotId);
  const graph = readGraph(shot);
  const node = findGenNode(graph, opts.nodeId);
  const model = nodeModel(node);
  const runs = nodeRunsOf(shotId);
  const prompt = resolvePrompt(shot, graph, node, model);
  const generic: GenericInputs = { prompt, durationSec: shot.durationSec };

  if (node.type === "imageEdit") {
    const max = model.maxReferenceImages ?? 4;
    const selector = incoming(graph, node.id, "views")[0];
    const viewIds = selector?.type === "refSelector" ? selectorViews(shot, graph, selector, max) : [];
    const imageIds: string[] = [];
    for (const src of incoming(graph, node.id, "images")) {
      const id = await assetOf(shot, graph, src, runs);
      if (id) imageIds.push(id);
    }
    const ids = [...new Set([...imageIds, ...viewIds])].slice(0, max);
    if (ids.length === 0) throw new GenerationError("Branche des images ou une sélection de vues sur ce node", 400);
    generic.referenceImageUrls = await uploadAssets(ids);
  }
  if (node.type === "videoGen") {
    const start = incoming(graph, node.id, "start")[0];
    const startId = start ? await assetOf(shot, graph, start, runs) : undefined;
    if (!startId) throw new GenerationError("Il faut une image de départ (génère ou importe une image en amont)", 400);
    [generic.startImageUrl] = await uploadAssets([startId]);
    const end = incoming(graph, node.id, "end")[0];
    if (end) {
      if (!model.supportsStartEndFrames) throw new GenerationError("Ce modèle vidéo n'accepte pas d'image de fin", 400);
      const endId = await assetOf(shot, graph, end, runs);
      if (endId) [generic.endImageUrl] = await uploadAssets([endId]);
    }
  }

  // Seeds: locked = base, base+1… so variants stay comparable; else random.
  let base = node.data.seed;
  if (node.data.seedLocked && base === undefined) {
    base = randomInt(1, 2 ** 31 - 1);
    node.data.seed = base;
    db.update(schema.shots).set({ graph }).where(eq(schema.shots.id, shotId)).run();
  }

  const created: NodeRun[] = [];
  for (let i = 0; i < estimate.variants; i++) {
    const seed = model.supportsSeed ? (node.data.seedLocked && base !== undefined ? base + i : randomInt(1, 2 ** 31 - 1)) : undefined;
    const body = { model: model.id, ...model.mapInputs({ ...generic, seed }) };
    const run = db
      .insert(schema.nodeRuns)
      .values({
        shotId,
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

/** Sends a canvas result to its shot: it becomes a storyboard take (cost already counted on the run). */
export function sendToShot(runId: string): Take {
  const db = getDb();
  const run = db.select().from(schema.nodeRuns).where(eq(schema.nodeRuns.id, runId)).get();
  if (!run) throw new GenerationError("Résultat introuvable", 404);
  if (run.status !== "completed" || !run.assetId) throw new GenerationError("Ce résultat n'est pas terminé", 400);
  if (run.sentTakeId) {
    const existing = db.select().from(schema.takes).where(eq(schema.takes.id, run.sentTakeId)).get();
    if (existing) return existing;
  }
  const take = db
    .insert(schema.takes)
    .values({
      shotId: run.shotId,
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
  db.update(schema.nodeRuns).set({ sentTakeId: take.id }).where(eq(schema.nodeRuns.id, run.id)).run();
  refreshShotStatus(run.shotId);
  return take;
}
