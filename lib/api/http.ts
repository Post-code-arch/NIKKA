import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { GenerationError } from "@/lib/generation/service";

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function notFound(what = "Ressource") {
  return NextResponse.json({ error: `${what} introuvable` }, { status: 404 });
}

/** Wraps a route handler: Zod → 400, GenerationError → its status, else 500. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response> | Response) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Requête invalide", issues: err.issues }, { status: 400 });
      }
      if (err instanceof GenerationError) {
        return NextResponse.json({ error: err.message, ...err.details }, { status: err.status });
      }
      console.error(err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "Erreur serveur" }, { status: 500 });
    }
  };
}

export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => ({}));
  return schema.parse(raw);
}
