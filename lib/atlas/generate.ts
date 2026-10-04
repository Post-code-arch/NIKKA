import { assertServer, isMockMode } from "./config";
import { atlasJson } from "./http";
import { mockSubmit } from "./mock";
import { SubmitResponseSchema } from "./schemas";

export type GenerationEndpoint = "generateImage" | "generateVideo";

/**
 * Body sent to Atlas: `model` plus the model's own parameters, already mapped
 * by the model registry adapter. Never retried (billable).
 */
export type GenerationBody = { model: string } & Record<string, unknown>;

export interface SubmittedPrediction {
  predictionId: string;
  endpoint: GenerationEndpoint;
  status?: string;
}

async function submit(endpoint: GenerationEndpoint, body: GenerationBody): Promise<SubmittedPrediction> {
  assertServer();
  if (isMockMode()) {
    return {
      predictionId: mockSubmit(endpoint === "generateImage" ? "image" : "video", body),
      endpoint,
      status: "created",
    };
  }
  const res = await atlasJson(SubmitResponseSchema, `/model/${endpoint}`, {
    method: "POST",
    body,
  });
  return { predictionId: res.data.id, endpoint, status: res.data.status };
}

export function generateImage(body: GenerationBody) {
  return submit("generateImage", body);
}

export function generateVideo(body: GenerationBody) {
  return submit("generateVideo", body);
}
