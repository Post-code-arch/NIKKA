import { choicesOf, optionKey, type ModelOptions } from "@/lib/models/options";

/** PRD §11: unit price × (images | seconds) × variants. */
export interface PricingLike {
  pricing: { unit: "image" | "second" | "request"; usd: number };
  /** Durations the model accepts; a request is snapped to the closest one. */
  durations?: number[];
  /** Real unit price learned per definition / quality ("4K", "1080p · high"). */
  pricingByOption?: Record<string, number>;
}

export function estimateCostUsd(
  model: PricingLike,
  opts: { seconds?: number; variants?: number; option?: string } = {},
): number {
  const variants = Math.max(1, opts.variants ?? 1);
  const units = model.pricing.unit === "second" ? billedSeconds(model, opts.seconds ?? 0) : 1;
  return round(unitPriceFor(model, opts.option) * units * variants);
}

/** Unit price for a definition / quality: the one seen on a bill, else the model's price. */
export function unitPriceFor(model: PricingLike, option?: string): number {
  return (option ? model.pricingByOption?.[option] : undefined) ?? model.pricing.usd;
}

/** True when the price of this definition / quality was never seen on a bill. */
export function priceUnconfirmed(
  model: PricingLike & { mock?: boolean; priceConfirmed?: boolean; options?: ModelOptions },
  option?: string,
): boolean {
  if (model.mock) return false;
  if (option && model.pricingByOption?.[option] !== undefined) return false;
  // The base price stands for the model's default definition / quality only.
  const isDefault = !option || option === optionKey(model.options, choicesOf(model.options).defaults);
  return !(isDefault && model.priceConfirmed);
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
