import { handle, json } from "@/lib/api/http";
import { validateGeneration } from "@/lib/refs/pack";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => json(validateGeneration((await params).id)));
