import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Shot, Take } from "@/db/schema";
import { cameraPhrase } from "@/lib/camera/phrasing";
import { DEFAULT_CAMERA } from "@/lib/camera/types";
import { DEFAULT_CONFIRM_THRESHOLD_USD, estimateCostUsd, round } from "@/lib/cost/estimate";
import { GenerationError, createTake } from "@/lib/generation/service";
import { extractFrame } from "@/lib/media/frame";
import { availableModels, getModel } from "@/lib/models/registry";
import type { ModelEntry, ModelKind } from "@/lib/models/types";
import { buildPrompt } from "@/lib/prompt/build";
import {
  buildRecipeGraph,
  generationNodes,
  isRecipeId,
  refIdsFromGraph,
  suggestRecipe,
  syncReferenceNodes,
  type RecipeId,
} from "@/lib/recipes";
import { selectReferenceViews } from "@/lib/refs/select";
import { NODE_SPECS, ShotGraphSchema, incoming, isValidEdge, type GraphNode, type ShotGraphData } from "./types";

/**
 * Server executor of a shot sub-graph (PRD §9): resolves each generation
 * node's inputs (prompt, reference views, start image) and launches takes.
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
  return parsed.success ? parsed.data : { nodes: [], edges: [] };
}

function saveGraph(shotId: string, graph: ShotGraphData, extra: Partial<Pick<Shot, "recipeId">> = {}) {
  const refIds = refIdsFromGraph(graph);
  getDb()
    .update(schema.shots)
    .set({ graph, refIds, ...extra })
    .where(eq(schema.shots.id, shotId))
    .run();
}

function shotRefs(refIds: string[]) {
  if (refIds.length === 0) return [];
  const rows = getDb().select().from(schema.references).where(inArray(schema.references.id, refIds)).all();
  return refIds.map((id) => rows.find((r) => r.id === id)).filter((r) => !!r);
}

/** Returns the shot's graph, building it from its recipe the first time. */
export function ensureShotGraph(shotId: string): { graph: ShotGraphData; recipeId: RecipeId } {
  const { shot, project } = loadShot(shotId);
  const graph = readGraph(shot);
  const recipe: RecipeId = isRecipeId(shot.recipeId) ? shot.recipeId : "free";
  if (graph.nodes.length > 0) return { graph, recipeId: recipe };
  const refs = shotRefs(shot.refIds);
  const chosen = recipe === "free" && refs.length ? suggestRecipe(refs.map((r) => r.tag)) : recipe;
  const built = buildRecipeGraph(chosen, refs.map((r) => ({ id: r.id, tag: r.tag })), projectModels(project.settings));
  saveGraph(shotId, built, { recipeId: chosen });
  return { graph: built, recipeId: chosen };
}

/** Replaces the graph with a fresh copy of a recipe (existing takes are kept). */
export function applyRecipe(shotId: string, recipe: RecipeId) {
  const { shot, project } = loadShot(shotId);
  const refs = shotRefs(shot.refIds);
  const built = buildRecipeGraph(recipe, refs.map((r) => ({ id: r.id, tag: r.tag })), projectModels(project.settings));
  saveGraph(shotId, built, { recipeId: recipe });
  return { graph: built, recipeId: recipe };
}

/** Validates and stores an edited graph; references follow the Reference nodes. */
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

/** The shot's refIds changed elsewhere (inspector, drop): mirror them in the graph. */
export function syncGraphRefs(shotId: string) {
  const { shot } = loadShot(shotId);
  const graph = readGraph(shot);
  if (graph.nodes.length === 0) return;
  saveGraph(shotId, syncReferenceNodes(graph, shot.refIds));
}

// --- input resolution ----------------------------------------------------------

function refsOn(graph: ShotGraphData, node: GraphNode, handle: string) {
  const ids = incoming(graph, node.id, handle)
    .filter((n) => n.type === "reference" && n.data.referenceId)
    .map((n) => n.data.referenceId!);
  return shotRefs([...new Set(ids)]);
}

export function resolvePrompt(shot: Shot, graph: ShotGraphData, gen: GraphNode, model: ModelEntry): string {
  const builder = incoming(graph, gen.id, "prompt")[0];
  if (!builder || builder.type !== "promptBuilder") throw new GenerationError("Branche un node Prompt sur ce node", 400);
  const refs = refsOn(graph, builder, "refs");
  const camera = shot.camera?.value ?? DEFAULT_CAMERA;
  const stage = NODE_SPECS[gen.type].generates === "video" ? "video" : "keyframe";
  const action = builder.data.override?.trim() || shot.description.value;
  return buildPrompt({
    descriptors: refs.filter((r) => r.tag !== "look").map((r) => ({ name: r.name, descriptor: r.descriptor })),
    action,
    camera: cameraPhrase(stage, camera, model.camera),
    looks: refs.filter((r) => r.tag === "look").map((r) => ({ name: r.name, descriptor: r.descriptor })),
  }).prompt;
}

export function resolveViews(shot: Shot, graph: ShotGraphData, gen: GraphNode, model: ModelEntry) {
  const selector = incoming(graph, gen.id, "views")[0];
  if (!selector || selector.type !== "refSelector") throw new GenerationError("Branche un node « Sélection des vues »", 400);
  if (selector.data.manualViews?.length) return { assetIds: selector.data.manualViews, picked: null };
  const refs = refsOn(graph, selector, "refs");
  const variants = refs.length
    ? getDb().select().from(schema.referenceVariants).where(inArray(schema.referenceVariants.referenceId, refs.map((r) => r.id))).all()
    : [];
  const selection = selectReferenceViews(
    refs.map((r) => ({ id: r.id, name: r.name, tag: r.tag, views: variants.find((v) => v.referenceId === r.id)?.views ?? [] })),
    shot.camera?.value ?? DEFAULT_CAMERA,
    model.maxReferenceImages ?? 4,
  );
  return { assetIds: selection.picked.map((p) => p.assetId), picked: selection };
}

/** Takes collected by a Take node: every take of its stage for the shot. */
export function takesForStage(shotId: string, stage: "keyframe" | "video"): Take[] {
  const stages = stage === "video" ? (["video"] as const) : (["keyframe", "sketch"] as const);
  return getDb()
    .select()
    .from(schema.takes)
    .where(and(eq(schema.takes.shotId, shotId), inArray(schema.takes.stage, [...stages])))
    .orderBy(desc(schema.takes.createdAt))
    .all();
}

/** The take a Take node passes on: its chosen one, the shot's retained one, else the latest completed. */
export function retainedTake(shot: Shot, node: GraphNode): Take | undefined {
  const stage = node.data.stage === "video" ? "video" : "keyframe";
  const list = takesForStage(shot.id, stage).filter((t) => t.status === "completed");
  return (
    list.find((t) => t.id === node.data.takeId) ??
    list.find((t) => t.id === shot.selectedTakeId) ??
    list[0]
  );
}

function previousShotVideo(shot: Shot): Take | undefined {
  const db = getDb();
  const siblings = db.select().from(schema.shots).where(eq(schema.shots.sequenceId, shot.sequenceId)).orderBy(asc(schema.shots.order)).all();
  const prev = siblings[siblings.findIndex((s) => s.id === shot.id) - 1];
  if (!prev) return undefined;
  const videos = takesForStage(prev.id, "video").filter((t) => t.status === "completed");
  return videos.find((t) => t.id === prev.selectedTakeId) ?? videos[0];
}

async function resolveStart(shot: Shot, graph: ShotGraphData, gen: GraphNode): Promise<{ assetId: string; parentTakeId?: string }> {
  const source = incoming(graph, gen.id, "start")[0];
  if (!source) throw new GenerationError("Branche une image de départ sur ce node vidéo", 400);
  if (source.type === "take") {
    const take = retainedTake(shot, source);
    if (!take?.assetId) throw new GenerationError("Génère et valide d'abord une image clé", 400);
    return { assetId: take.assetId, parentTakeId: take.id };
  }
  if (source.type === "frameExtract") {
    let videoTake: Take | undefined;
    if (source.data.source === "previous_shot") videoTake = previousShotVideo(shot);
    else {
      const upstream = incoming(graph, source.id, "video")[0];
      if (upstream?.type === "take") videoTake = retainedTake(shot, upstream);
    }
    if (!videoTake?.assetId) throw new GenerationError("Aucune vidéo retenue à prolonger (plan précédent ou entrée)", 400);
    const asset = getDb().select().from(schema.assets).where(eq(schema.assets.id, videoTake.assetId)).get()!;
    const frame = await extractFrame(asset, source.data.which ?? "last");
    return { assetId: frame.id, parentTakeId: videoTake.id };
  }
  throw new GenerationError("Entrée image non prise en charge", 400);
}

// --- running -------------------------------------------------------------------

export interface RunOptions {
  /** Generation node to run; default: the first one producing `until`. */
  nodeId?: string;
  until?: "keyframe" | "video";
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

function pickNode(graph: ShotGraphData, opts: RunOptions): GraphNode {
  if (opts.nodeId) {
    const n = graph.nodes.find((x) => x.id === opts.nodeId);
    if (!n || !NODE_SPECS[n.type].generates) throw new GenerationError("Ce node ne génère rien", 400);
    return n;
  }
  const target = opts.until ?? "keyframe";
  const n = generationNodes(graph).find((x) => NODE_SPECS[x.type].generates === target);
  if (!n) throw new GenerationError(target === "video" ? "Aucun node vidéo dans ce plan" : "Aucun node d'image dans ce plan", 400);
  return n;
}

function nodeModel(node: GraphNode): ModelEntry {
  const kind: ModelKind = node.type === "imageEdit" ? "i2i" : node.type === "videoGen" ? "i2v" : "t2i";
  const model = node.data.modelId ? getModel(node.data.modelId) : undefined;
  const chosen = model?.kind === kind ? model : availableModels(kind)[0];
  if (!chosen) throw new GenerationError("Aucun modèle disponible pour ce node", 400);
  return chosen;
}

export function estimateRun(shotId: string, opts: RunOptions): RunEstimate {
  const { shot, project } = loadShot(shotId);
  const { graph } = ensureShotGraph(shotId);
  const node = pickNode(graph, opts);
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
    // Every batch (variants) needs a confirmation (PRD §11).
    needsConfirmation: total > threshold || variants > 1,
  };
}

/** Runs one generation node (×variants). Never retried; each variant is a new take. */
export async function runShot(shotId: string, opts: RunOptions): Promise<{ estimate: RunEstimate; takes: Take[] }> {
  const estimate = estimateRun(shotId, opts);
  if (opts.estimateOnly) return { estimate, takes: [] };
  if (estimate.needsConfirmation && (opts.confirmedCostUsd ?? -1) < estimate.costEstimatedUsd) {
    throw new GenerationError("Confirmation du coût requise", 409, { ...estimate });
  }
  const { shot } = loadShot(shotId);
  const { graph } = ensureShotGraph(shotId);
  const node = graph.nodes.find((n) => n.id === estimate.nodeId)!;
  const model = nodeModel(node);
  const stage = NODE_SPECS[node.type].generates === "video" ? "video" : "keyframe";
  const prompt = resolvePrompt(shot, graph, node, model);
  const views = node.type === "imageEdit" ? resolveViews(shot, graph, node, model).assetIds : undefined;
  if (views && views.length === 0) throw new GenerationError("Aucune vue de référence : ajoute des images aux références branchées", 400);
  const start = node.type === "videoGen" ? await resolveStart(shot, graph, node) : undefined;

  // Seeds: locked = base seed then +1, +2… so variants stay comparable; else random.
  let base = node.data.seed;
  if (node.data.seedLocked && base === undefined) {
    base = randomInt(1, 2 ** 31 - 1);
    node.data.seed = base;
    saveGraph(shotId, graph);
  }
  const takes: Take[] = [];
  for (let i = 0; i < estimate.variants; i++) {
    const seed = model.supportsSeed ? (node.data.seedLocked && base !== undefined ? base + i : randomInt(1, 2 ** 31 - 1)) : undefined;
    takes.push(
      await createTake({
        shotId,
        modelId: model.id,
        stage,
        prompt,
        seed,
        durationSec: shot.durationSec,
        parentTakeId: start?.parentTakeId,
        startAssetId: start?.assetId,
        referenceAssetIds: views,
        nodeId: node.id,
        confirmedCostUsd: estimate.unitCostUsd,
      }),
    );
  }
  return { estimate, takes };
}

/** Retains a take: on its Take node and as the shot's retained take (storyboard). */
export function selectTake(shotId: string, takeId: string, nodeId?: string) {
  const { shot } = loadShot(shotId);
  const take = getDb().select().from(schema.takes).where(eq(schema.takes.id, takeId)).get();
  if (!take || take.shotId !== shotId) throw new GenerationError("Cette prise n'appartient pas au plan", 400);
  if (take.status !== "completed") throw new GenerationError("Cette prise n'est pas terminée", 400);
  const graph = readGraph(shot);
  const target =
    graph.nodes.find((n) => n.id === nodeId) ??
    graph.nodes.find((n) => n.type === "take" && (n.data.stage === "video") === (take.stage === "video"));
  if (target) {
    target.data.takeId = take.id;
    saveGraph(shotId, graph);
  }
  getDb().update(schema.shots).set({ selectedTakeId: take.id }).where(eq(schema.shots.id, shotId)).run();
  return take;
}
