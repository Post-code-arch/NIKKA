import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import type { CatalogModel, PredictionData } from "./schemas";

/**
 * Mock Atlas backend (NIKKA_MOCK_ATLAS=1).
 * Stateless: the prediction id encodes kind, creation time and a seed, so any
 * process (route handler, poller, script) can answer for it.
 */

const execFileAsync = promisify(execFile);

export const MOCK_SCHEME = "mock://";

function delayMs(kind: "image" | "video"): number {
  const env = process.env.NIKKA_MOCK_DELAY_MS;
  if (env !== undefined && !Number.isNaN(Number(env))) return Number(env);
  return kind === "image" ? 2000 : 4000;
}

export function mockSubmit(kind: "image" | "video", body: Record<string, unknown>): string {
  const seed = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 8);
  return `mock-${kind}-${Date.now()}-${seed}-${randomBytes(3).toString("hex")}`;
}

export function mockPrediction(id: string): PredictionData {
  const m = /^mock-(image|video)-(\d+)-([0-9a-f]+)-/.exec(id);
  if (!m) return { id, status: "failed", error: "Unknown mock prediction id" };
  const kind = m[1] as "image" | "video";
  const created = Number(m[2]);
  if (Date.now() - created < delayMs(kind)) return { id, status: "processing" };
  const ext = kind === "image" ? "png" : "mp4";
  return {
    id,
    model: `mock/${kind}`,
    status: "completed",
    outputs: [`${MOCK_SCHEME}${kind}/${m[3]}.${ext}`],
  };
}

export function mockUpload(fileName: string): string {
  return `${MOCK_SCHEME}upload/${randomBytes(6).toString("hex")}/${fileName}`;
}

// --- Fake media --------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Diagonal gradient PNG whose colors derive from the seed. */
export function makeMockPng(seedHex: string, width = 512, height = 288): Buffer {
  const s = parseInt(seedHex.slice(0, 6).padEnd(6, "0"), 16);
  const c1 = [(s >> 16) & 0xff, (s >> 8) & 0xff, s & 0xff];
  const c2 = [255 - c1[0], 255 - c1[1], 255 - c1[2]];
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      for (let ch = 0; ch < 3; ch++) {
        raw[row + 1 + x * 3 + ch] = Math.round(c1[ch] * (1 - t) + c2[ch] * t);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Short test-pattern MP4 rendered with ffmpeg (required server-side anyway). */
export async function makeMockMp4(seedHex: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nikka-mock-"));
  const out = path.join(dir, `${seedHex}.mp4`);
  try {
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=2",
      "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
      out,
    ]);
    return await readFile(out);
  } catch (err) {
    throw new Error(`Mock video needs ffmpeg on PATH (or FFMPEG_PATH): ${String(err)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function fetchMockMedia(url: string): Promise<{ data: Buffer; contentType: string }> {
  const rest = url.slice(MOCK_SCHEME.length);
  const [kind, file] = rest.split("/");
  const seed = (file ?? "").split(".")[0] || "808080";
  if (kind === "image") return { data: makeMockPng(seed), contentType: "image/png" };
  if (kind === "video") return { data: await makeMockMp4(seed), contentType: "video/mp4" };
  throw new Error(`Cannot download mock url ${url}`);
}

// --- Mock catalog --------------------------------------------------------------

const MOCK_SCHEMAS: Record<string, unknown> = {
  "mock/text-to-image": {
    components: {
      schemas: {
        Input: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string" },
            size: { type: "string", default: "1024*1024", enum: ["1024*1024", "1280*720"] },
            seed: { type: "integer", default: -1 },
          },
        },
      },
    },
  },
  "mock/image-to-video": {
    components: {
      schemas: {
        Input: {
          type: "object",
          required: ["prompt", "image"],
          properties: {
            prompt: { type: "string" },
            image: { type: "string", description: "Start frame URL" },
            duration: { type: "integer", default: 5, enum: [5, 10] },
          },
        },
      },
    },
  },
};

export const MOCK_CATALOG: CatalogModel[] = [
  {
    model: "mock/text-to-image",
    type: "Image",
    displayName: "Mock Text-to-Image",
    schema: `${MOCK_SCHEME}schema/mock/text-to-image`,
    display_console: true,
    price: { actual: { base_price: "0.003", unit: "image" } },
  },
  {
    model: "mock/image-to-video",
    type: "Video",
    displayName: "Mock Image-to-Video",
    schema: `${MOCK_SCHEME}schema/mock/image-to-video`,
    display_console: true,
    price: { actual: { base_price: "0.01", unit: "second" } },
  },
  {
    model: "mock/llm",
    type: "Text",
    displayName: "Mock LLM",
    display_console: true,
    price: { actual: { input_price: "0", output_price: "0" } },
  },
];

export function mockSchema(url: string): unknown {
  const id = url.slice(`${MOCK_SCHEME}schema/`.length);
  const s = MOCK_SCHEMAS[id];
  if (!s) throw new Error(`No mock schema for ${id}`);
  return s;
}
