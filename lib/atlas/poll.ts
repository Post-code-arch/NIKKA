import { assertServer, isMockMode } from "./config";
import { AtlasError, atlasRequest, parseOrThrow } from "./http";
import { mockPrediction } from "./mock";
import {
  FAILURE_STATUSES,
  PredictionResponseSchema,
  SUCCESS_STATUSES,
  type PredictionData,
} from "./schemas";

export type PredictionState = "pending" | "completed" | "failed";

export function predictionState(data: PredictionData): PredictionState {
  const s = data.status.toLowerCase();
  if (SUCCESS_STATUSES.has(s)) return "completed";
  if (FAILURE_STATUSES.has(s)) return "failed";
  return "pending";
}

/** Output URLs of a completed prediction, whatever shape Atlas used. */
export function predictionOutputs(data: PredictionData): string[] {
  const out: string[] = [];
  for (const item of data.outputs ?? []) {
    if (typeof item === "string") out.push(item);
    else if (typeof item.url === "string") out.push(item.url);
  }
  if (out.length === 0 && data.output) {
    out.push(...(Array.isArray(data.output) ? data.output : [data.output]));
  }
  return out;
}

export function predictionError(data: PredictionData): string {
  const e = data.error;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object") return JSON.stringify(e);
  return `Prediction ${data.status}`;
}

/**
 * Single status read. Atlas reports a failed task as HTTP 5xx with the
 * terminal payload in the body; that is an answer, not an outage.
 */
export async function getPrediction(predictionId: string): Promise<PredictionData> {
  assertServer();
  if (isMockMode()) return mockPrediction(predictionId);

  const { ok, status, body } = await atlasRequest(
    `/model/prediction/${encodeURIComponent(predictionId)}`,
    { retries: 2 },
  );
  const parsed = PredictionResponseSchema.safeParse(body);
  if (parsed.success && (ok || predictionState(parsed.data.data) === "failed")) {
    return parsed.data.data;
  }
  if (!ok) throw new AtlasError(`Prediction poll failed: HTTP ${status}`, status, body);
  return parseOrThrow(PredictionResponseSchema, body, "prediction").data;
}

export interface WaitOptions {
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  timeoutMs?: number;
  onUpdate?: (data: PredictionData) => void;
}

export class PredictionTimeoutError extends Error {
  constructor(readonly predictionId: string, timeoutMs: number) {
    super(`Prediction ${predictionId} still pending after ${Math.round(timeoutMs / 1000)}s (not failed: resume polling, do not resubmit)`);
    this.name = "PredictionTimeoutError";
  }
}

/**
 * Polls until terminal state with progressive backoff (3s → 10s by default).
 * Returns the terminal payload; failures are returned, not thrown, so the
 * caller can record them on the Take.
 */
export async function waitForPrediction(
  predictionId: string,
  opts: WaitOptions = {},
): Promise<PredictionData> {
  const initial = opts.initialIntervalMs ?? (isMockMode() ? 500 : 3000);
  const max = opts.maxIntervalMs ?? 10_000;
  const factor = opts.backoffFactor ?? 1.3;
  const timeout = opts.timeoutMs ?? 15 * 60_000;
  const start = Date.now();
  let interval = initial;

  for (;;) {
    const data = await getPrediction(predictionId);
    opts.onUpdate?.(data);
    if (predictionState(data) !== "pending") return data;
    if (Date.now() - start + interval > timeout) throw new PredictionTimeoutError(predictionId, timeout);
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(max, Math.round(interval * factor));
  }
}
