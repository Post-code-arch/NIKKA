import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function isHdr(v: { pix_fmt?: string; color_transfer?: string; color_primaries?: string }) {
  return /arib-std-b67|smpte2084/.test(v.color_transfer ?? "") || v.color_primaries === "bt2020";
}

/** Proper tone mapping (needs ffmpeg built with zimg, as Homebrew's is). */
const HDR_TO_SDR_ZSCALE =
  "zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
/** Without zimg: plain conversion to 8-bit BT.709 (a little flat, but accepted everywhere). */
const HDR_TO_SDR_FALLBACK = "scale=in_color_matrix=bt2020:out_color_matrix=bt709:out_range=tv,format=yuv420p";

/**
 * Phone videos often arrive as HEVC .mov with extra metadata tracks: some
 * browsers can't play them and some models reject them. On import they are
 * re-encoded once as H.264/AAC MP4 (rotation applied). Already-H.264 MP4s are
 * kept untouched. Best effort: without ffmpeg the original is kept.
 */
export async function normalizeVideo(data: Buffer, fileName: string): Promise<{ data: Buffer; contentType: string; fileName: string } | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nikka-norm-"));
  const input = path.join(dir, "in" + (path.extname(fileName) || ".mov"));
  const output = path.join(dir, "out.mp4");
  try {
    await writeFile(input, data);
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,pix_fmt,color_transfer,color_primaries:format=format_name", "-of", "json", input,
    ]);
    const j = JSON.parse(stdout) as {
      streams?: { codec_name?: string; pix_fmt?: string; color_transfer?: string; color_primaries?: string }[];
      format?: { format_name?: string };
    };
    const v = j.streams?.[0] ?? {};
    const hdr = isHdr(v);
    const isMp4 = /mp4/.test(j.format?.format_name ?? "") && /\.mp4$/i.test(fileName);
    if (v.codec_name === "h264" && isMp4 && !hdr && v.pix_fmt === "yuv420p") return null;
    // HDR (iPhone HLG / Dolby Vision, HDR10): tone-mapped to SDR BT.709 — models reject HDR.
    const filters = hdr ? [HDR_TO_SDR_ZSCALE, HDR_TO_SDR_FALLBACK] : [null];
    let done = false;
    for (const vf of filters) {
      try {
        await execFileAsync(
          process.env.FFMPEG_PATH ?? "ffmpeg",
          [
            "-hide_banner", "-loglevel", "error", "-y", "-i", input,
            "-map", "0:v:0", "-map", "0:a:0?",
            ...(vf ? ["-vf", vf] : []),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
            output,
          ],
          { timeout: 5 * 60_000 },
        );
        done = true;
        break;
      } catch {
        // next filter
      }
    }
    if (!done) return null;
    return { data: await readFile(output), contentType: "video/mp4", fileName: fileName.replace(/\.[^.]+$/, "") + ".mp4" };
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
