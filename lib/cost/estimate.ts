/** PRD §11: unit price × (images | seconds) × variants. */
export interface PricingLike {
  pricing: { unit: "image" | "second" | "request"; usd: number };
  /** Durations the model accepts; a request is snapped to the closest one. */
  durations?: number[];
}

export function estimateCostUsd(
  model: PricingLike,
  opts: { seconds?: number; variants?: number } = {},
): number {
  const variants = Math.max(1, opts.variants ?? 1);
  const units = model.pricing.unit === "second" ? billedSeconds(model, opts.seconds ?? 0) : 1;
  return round(model.pricing.usd * units * variants);
}

/** Seconds the model will really produce: the closest duration it accepts. */
export function billedSeconds(model: { durations?: number[] }, seconds: number): number {
  const allowed = model.durations?.filter((d) => d > 0) ?? [];
  if (!allowed.length || seconds <= 0) return Math.max(0, seconds);
  return allowed.reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a));
}

export const DEFAULT_CONFIRM_THRESHOLD_USD = 2;

export function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

export function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "—";
  return `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}
