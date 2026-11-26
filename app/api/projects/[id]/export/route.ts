import { handle } from "@/lib/api/http";
import { exportProject } from "@/lib/projects/transfer";

type Ctx = { params: Promise<{ id: string }> };

/** Downloads the whole project (data + media) as a .nikka.zip. */
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { fileName, data } = exportProject((await params).id);
  return new Response(Buffer.from(data), {
    headers: {
      "content-type": "application/zip",
      // ASCII fallback for old clients, exact UTF-8 name for browsers.
      "content-disposition": `attachment; filename="${fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
});
