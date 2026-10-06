import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getAssetsDir } from "@/lib/atlas/config";
import { handle, notFound } from "@/lib/api/http";

type Ctx = { params: Promise<{ id: string }> };

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
};

/**
 * Serves a locally stored asset (never an Atlas URL). Supports byte ranges,
 * which Safari requires to play video.
 */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const asset = getDb().select().from(schema.assets).where(eq(schema.assets.id, id)).get();
  if (!asset) return notFound("Média");
  const file = path.resolve(asset.path);
  if (!file.startsWith(getAssetsDir() + path.sep)) return notFound("Média");
  const info = await stat(file).catch(() => null);
  if (!info) return notFound("Fichier");

  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const size = info.size;
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(info.size) } });
});
