import { handle, json } from "@/lib/api/http";
import { importProject } from "@/lib/projects/transfer";

/** Imports a .nikka.zip as a new project (multipart field "file"). */
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Aucun fichier" }, { status: 400 });
  return json(await importProject(new Uint8Array(await file.arrayBuffer())), { status: 201 });
});
