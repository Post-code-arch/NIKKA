import { handle, json } from "@/lib/api/http";
import { normalizeVideo } from "@/lib/media/normalize";
import { storeAsset } from "@/lib/media/store";

const MAX_BYTES = 50 * 1024 * 1024;

/** Upload of local images/videos (multipart field "files"). Stays local, nothing goes to Atlas. */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return json({ error: "Aucun fichier" }, { status: 400 });
  const out = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return json({ error: `${file.name} dépasse 50 Mo` }, { status: 400 });
    if (!/^(image|video)\//.test(file.type)) return json({ error: `${file.name} n'est pas une image ni une vidéo` }, { status: 400 });
    const raw = Buffer.from(await file.arrayBuffer());
    const norm = file.type.startsWith("video/") ? await normalizeVideo(raw, file.name) : null;
    const asset = norm ? await storeAsset(norm.data, norm.contentType, norm.fileName) : await storeAsset(raw, file.type, file.name);
    out.push({ id: asset.id, kind: asset.kind, width: asset.width, height: asset.height, durationSec: asset.durationSec });
  }
  return json(out, { status: 201 });
});
