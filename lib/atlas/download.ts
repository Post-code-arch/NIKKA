import { createHash } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOWNLOAD_TIMEOUT_MS, assertServer, getAssetsDir } from "./config";
import { AtlasError, ensureProxy } from "./http";
import { MOCK_SCHEME, fetchMockMedia } from "./mock";

export interface StoredFile {
  /** Path relative to the project root, e.g. storage/assets/ab12….png */
  path: string;
  absolutePath: string;
  sha256: string;
  bytes: number;
  contentType: string;
  kind: "image" | "video" | "other";
  sourceUrl: string;
}

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([t, e]) => [e, t]),
);
TYPE_BY_EXT[".jpeg"] = "image/jpeg";

function resolveType(headerType: string | null, url: string): { type: string; ext: string } {
  const clean = (headerType ?? "").split(";")[0].trim().toLowerCase();
  if (EXT_BY_TYPE[clean]) return { type: clean, ext: EXT_BY_TYPE[clean] };
  const urlExt = path.extname(new URL(url).pathname).toLowerCase();
  if (TYPE_BY_EXT[urlExt]) return { type: TYPE_BY_EXT[urlExt], ext: urlExt === ".jpeg" ? ".jpg" : urlExt };
  return { type: clean || "application/octet-stream", ext: urlExt || ".bin" };
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchBytes(url: string): Promise<{ data: Buffer; contentType: string | null }> {
  if (url.startsWith(MOCK_SCHEME)) return fetchMockMedia(url);
  await ensureProxy();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new AtlasError(`Download failed: HTTP ${res.status} for ${url}`, res.status);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads one output into storage/assets, content-addressed by sha256.
 * Identical files are stored once.
 */
export async function downloadToAssets(url: string): Promise<StoredFile> {
  assertServer();
  const { data, contentType } = await fetchBytes(url);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const { type, ext } = resolveType(contentType, url.startsWith(MOCK_SCHEME) ? `http://mock/${url.slice(MOCK_SCHEME.length)}` : url);
  const dir = getAssetsDir();
  await mkdir(dir, { recursive: true });
  const absolutePath = path.join(dir, `${sha256}${ext}`);
  if (!(await exists(absolutePath))) {
    const tmp = `${absolutePath}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, absolutePath);
  }
  return {
    path: path.relative(process.cwd(), absolutePath),
    absolutePath,
    sha256,
    bytes: data.length,
    contentType: type,
    kind: type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "other",
    sourceUrl: url,
  };
}

export async function downloadOutputs(urls: string[]): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  for (const url of urls) files.push(await downloadToAssets(url));
  return files;
}
