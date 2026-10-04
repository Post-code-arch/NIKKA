import path from "node:path";

/**
 * Server-side configuration for Atlas Cloud.
 * The API key is read lazily and never exported to client code.
 */

export const ATLAS_API_BASE = "https://api.atlascloud.ai/api/v1";
export const ATLAS_LLM_BASE = "https://api.atlascloud.ai/v1";

export const REQUEST_TIMEOUT_MS = 30_000;
export const UPLOAD_TIMEOUT_MS = 300_000;
export const DOWNLOAD_TIMEOUT_MS = 300_000;

export function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/atlas must only run on the server");
  }
}

export function isMockMode(): boolean {
  return process.env.NIKKA_MOCK_ATLAS === "1";
}

export function getApiKey(): string {
  assertServer();
  const key = process.env.ATLASCLOUD_API_KEY;
  if (!key) {
    throw new Error("ATLASCLOUD_API_KEY is not set (add it to .env.local)");
  }
  return key;
}

export function getAssetsDir(): string {
  return path.resolve(process.env.NIKKA_ASSETS_DIR ?? "./storage/assets");
}
