import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface MediaInfo {
  width?: number;
  height?: number;
  durationSec?: number;
}

/** Reads dimensions/duration with ffprobe; returns {} if unavailable. */
export async function probeMedia(file: string): Promise<MediaInfo> {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH ?? "ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json", file,
    ]);
    const j = JSON.parse(stdout) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const d = j.format?.duration ? Number(j.format.duration) : undefined;
    return {
      width: j.streams?.[0]?.width,
      height: j.streams?.[0]?.height,
      durationSec: d && Number.isFinite(d) ? d : undefined,
    };
  } catch {
    return {};
  }
}
