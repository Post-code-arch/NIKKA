import { readFile } from "node:fs/promises";
import path from "node:path";
import { ATLAS_API_BASE, UPLOAD_TIMEOUT_MS, assertServer, getApiKey, isMockMode } from "./config";
import { AtlasError, ensureProxy, parseOrThrow } from "./http";
import { mockUpload } from "./mock";
import { UploadResponseSchema } from "./schemas";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/**
 * Uploads a local file and returns Atlas' temporary URL.
 * The URL is only meant to be passed to a generation call, never stored.
 */
export async function uploadMedia(filePath: string): Promise<string> {
  assertServer();
  const fileName = path.basename(filePath);
  if (isMockMode()) return mockUpload(fileName);

  await ensureProxy();
  const data = await readFile(filePath);
  const type = MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type }), fileName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${ATLAS_API_BASE}/model/uploadMedia`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getApiKey()}` },
      body: form,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (!res.ok) throw new AtlasError(`Upload failed: HTTP ${res.status}`, res.status, body);
    return parseOrThrow(UploadResponseSchema, body, "uploadMedia").data.download_url;
  } finally {
    clearTimeout(timer);
  }
}
