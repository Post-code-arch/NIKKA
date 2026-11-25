import { handle, json } from "@/lib/api/http";
import { sendToShot } from "@/lib/graph/run";

type Ctx = { params: Promise<{ id: string }> };

/** Sends a canvas result to its shot as a storyboard take. */
export const POST = handle(async (_req: Request, { params }: Ctx) => json(sendToShot((await params).id), { status: 201 }));
