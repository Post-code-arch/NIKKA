import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Asset } from "@/db/schema";
import { storeAsset } from "./store";

const execFileAsync = promisify(execFile);

/** Extracts the last (or first) frame of a local video as a new image asset (ffmpeg, server side). */
export async function extractFrame(video: Pick<Asset, "path">, which: "last" | "first" = "last"): Promise<Asset> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nikka-frame-"));
  const out = path.join(dir, "frame.png");
  const input = path.resolve(video.path);
  try {
    const args =
      which === "last"
        ? ["-hide_banner", "-loglevel", "error", "-y", "-sseof", "-0.25", "-i", input, "-frames:v", "1", "-update", "1", out]
        : ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-frames:v", "1", out];
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", args);
    return await storeAsset(await readFile(out), "image/png", "frame.png");
  } catch (err) {
    throw new Error(`Extraction d'image impossible (ffmpeg) : ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
