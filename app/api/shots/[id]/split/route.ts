import { handle, json } from "@/lib/api/http";
import { splitShot } from "@/lib/storyboard/ops";

type Ctx = { params: Promise<{ id: string }> };

/** Cuts a shot in two (the new half follows it). */
export const POST = handle(async (_req: Request, { params }: Ctx) => json(splitShot((await params).id), { status: 201 }));
