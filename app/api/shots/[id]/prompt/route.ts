import { handle, json, notFound } from "@/lib/api/http";
import { shotPromptPreview } from "@/lib/prompt/shot";

type Ctx = { params: Promise<{ id: string }> };

/** Final prompts of a shot for ?keyframe=<model>&video=<model>, with camera checks. */
export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const url = new URL(req.url);
  const preview = shotPromptPreview(id, {
    keyframe: url.searchParams.get("keyframe"),
    video: url.searchParams.get("video"),
  });
  return preview ? json(preview) : notFound("Plan");
});
