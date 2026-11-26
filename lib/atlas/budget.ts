import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

/**
 * Hard spending cap (NIKKA_SPEND_CAP_USD). Checked at the last moment before
 * any paid Atlas call. Every image/video generation is recorded with its
 * estimated cost just before submission, so the sum below already includes
 * the call being checked. LLM calls are logged to data/llm-usage.jsonl.
 */

export class SpendCapError extends Error {}

export function spendCapUsd(): number | null {
  const v = Number(process.env.NIKKA_SPEND_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function llmLog() {
  const db = path.resolve(/*turbopackIgnore: true*/ process.env.NIKKA_DB_PATH ?? "./data/nikka.db");
  return path.join(path.dirname(db), "llm-usage.jsonl");
}

export function recordLlmSpend(entry: { model: string; usd: number; promptTokens?: number; completionTokens?: number }) {
  const f = llmLog();
  mkdirSync(path.dirname(f), { recursive: true });
  appendFileSync(f, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
}

function llmSpentUsd(): number {
  const f = llmLog();
  if (!existsSync(f)) return 0;
  return readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((n, line) => n + (Number(JSON.parse(line).usd) || 0), 0);
}

/** Estimated spend on real (non-mock) Atlas calls so far, LLM included. */
export async function spentUsd(): Promise<number> {
  const { getDb } = await import("@/db");
  const db = getDb();
  // Submitted or about to be (a failed submission is not billed).
  const where = sql`model NOT LIKE 'mock/%' AND (status != 'failed' OR prediction_id IS NOT NULL)`;
  let total = 0;
  for (const table of ["takes", "node_runs", "ref_generations"]) {
    const row = db.get<{ s: number | null }>(sql`SELECT SUM(COALESCE(cost_actual_usd, cost_estimated_usd)) AS s FROM ${sql.raw(table)} WHERE ${where}`);
    total += row?.s ?? 0;
  }
  return total + llmSpentUsd();
}

/** Throws before a paid call that would take the total above the cap. */
export async function assertUnderCap(what: string) {
  const cap = spendCapUsd();
  if (cap === null) return;
  const spent = await spentUsd();
  if (spent > cap) {
    throw new SpendCapError(`Plafond de dépense atteint (${spent.toFixed(3)} $ sur ${cap} $) : ${what} non envoyé.`);
  }
}
