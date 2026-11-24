import { handle, json } from "@/lib/api/http";
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
    const asset = await storeAsset(Buffer.from(await file.arrayBuffer()), file.type, file.name);
    out.push({ id: asset.id, kind: asset.kind, width: asset.width, height: asset.height });
  }
  return json(out, { status: 201 });
});
