import { getDb, schema } from "@/db";
import type { Asset } from "@/db/schema";
import { writeToAssets } from "@/lib/atlas/download";
import { probeMedia } from "./probe";

/** Stores a local file (upload) in storage/assets and records the Asset. */
export async function storeAsset(data: Buffer, contentType: string | null, fileName: string): Promise<Asset> {
  const f = await writeToAssets(data, contentType, fileName);
  if (f.kind === "other") throw new Error(`Format non pris en charge : ${fileName}`);
  const info = await probeMedia(f.absolutePath);
  return getDb()
    .insert(schema.assets)
    .values({
      kind: f.kind,
      path: f.path,
      sha256: f.sha256,
      width: info.width,
      height: info.height,
      durationSec: f.kind === "video" ? info.durationSec : undefined,
    })
    .returning()
    .get();
}
