/** Thin typed client for the local API routes (browser side). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body);
  return body as T;
}

export function assetUrl(assetId: string) {
  return `/api/assets/${assetId}`;
}
