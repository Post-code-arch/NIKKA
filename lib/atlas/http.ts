import type { z } from "zod";
import { ATLAS_API_BASE, REQUEST_TIMEOUT_MS, assertServer, getApiKey } from "./config";

export class AtlasError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AtlasError";
  }
}

let proxyConfigured = false;

/**
 * Node's fetch ignores HTTPS_PROXY. When one is set (corporate network,
 * sandbox), route fetch through it once per process.
 */
export async function ensureProxy(): Promise<void> {
  if (proxyConfigured) return;
  proxyConfigured = true;
  if (!(process.env.HTTPS_PROXY || process.env.https_proxy)) return;
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  /** Retries only apply to GET: a POST may create a billable task. */
  retries?: number;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    for (const k of ["message", "msg", "error"]) {
      if (typeof b[k] === "string" && b[k]) return b[k] as string;
    }
  }
  return fallback;
}

/** Raw JSON request against the Atlas media API. Returns the parsed body. */
export async function atlasRequest(
  urlOrPath: string,
  opts: RequestOptions = {},
): Promise<{ status: number; ok: boolean; body: unknown }> {
  assertServer();
  await ensureProxy();
  const method = opts.method ?? "GET";
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${ATLAS_API_BASE}${urlOrPath}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) headers.Authorization = `Bearer ${getApiKey()}`;
  const maxRetries = method === "POST" ? 0 : (opts.retries ?? 3);

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const body = await readBody(res);
      if (!res.ok && isRetryableStatus(res.status) && attempt < maxRetries) {
        lastError = new AtlasError(errorMessage(body, `HTTP ${res.status}`), res.status, body);
        continue;
      }
      return { status: res.status, ok: res.ok, body };
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastError instanceof AtlasError) throw lastError;
  throw new AtlasError(`Network error on ${method} ${url}: ${String(lastError)}`);
}

/** Request + HTTP error handling + Zod validation of the success body. */
export async function atlasJson<S extends z.ZodType>(
  schema: S,
  urlOrPath: string,
  opts: RequestOptions = {},
): Promise<z.infer<S>> {
  const { status, ok, body } = await atlasRequest(urlOrPath, opts);
  if (!ok) throw new AtlasError(errorMessage(body, `HTTP ${status}`), status, body);
  return parseOrThrow(schema, body, urlOrPath);
}

export function parseOrThrow<S extends z.ZodType>(schema: S, body: unknown, context: string): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AtlasError(
      `Unexpected Atlas response for ${context}: ${parsed.error.message}`,
      undefined,
      body,
    );
  }
  return parsed.data;
}
