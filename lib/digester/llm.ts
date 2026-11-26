import { readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { isMockMode } from "@/lib/atlas/config";
import { chat, type ChatMessage } from "@/lib/atlas/llm";
import { GenerationError } from "@/lib/generation/service";
import { mockTask } from "./mock";

/** Digester tasks; each one has its system prompt in lib/digester/prompts/<task>.md. */
export type DigestTask = "diagnose" | "extract" | "concepts" | "concept" | "treatment" | "breakdown";

export class DigestError extends GenerationError {
  constructor(message: string, status = 502) {
    super(message, status);
  }
}

const PROMPTS_DIR = path.join(process.cwd(), "lib", "digester", "prompts");

/** Prompts are read on every call: editing a .md file takes effect without a rebuild. */
export function systemPrompt(task: DigestTask, vars: Record<string, string | number>) {
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ""));
  const read = (name: string) => readFileSync(path.join(PROMPTS_DIR, `${name}.md`), "utf8");
  return `${fill(read("common"))}\n\n${fill(read(task))}`;
}

type ChatFn = (messages: ChatMessage[]) => Promise<string>;
let chatOverride: ChatFn | null = null;
/** Tests only: replaces the LLM. */
export function setDigesterChat(fn: ChatFn | null) {
  chatOverride = fn;
}

function parseJson(text: string): unknown {
  // Some models wrap JSON in fences despite the instructions.
  const clean = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(clean);
}

function zodMessage(err: z.ZodError) {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Calls the LLM for a task and validates its JSON with Zod. On an invalid
 * answer, one retry that quotes the error; then the error is shown (PRD §6).
 */
export async function callJson<T extends z.ZodType>(
  task: DigestTask,
  schema: T,
  input: { brief: string; context?: unknown },
  vars: Record<string, string | number> = {},
): Promise<z.infer<T>> {
  if (!chatOverride && isMockMode()) {
    const parsed = schema.safeParse(mockTask(task, input, vars));
    if (!parsed.success) throw new DigestError(`Mock invalide (${task}) : ${zodMessage(parsed.error)}`, 500);
    return parsed.data;
  }
  const send: ChatFn = chatOverride ?? (async (m) => (await chat(m, { json: true, temperature: task === "concepts" ? 0.9 : 0.3 })).text);
  const user = [`BRIEF:\n${input.brief}`, input.context ? `CONTEXT (validated levels, JSON):\n${JSON.stringify(input.context, null, 2)}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(task, { language: "same as the brief", ...vars }) },
    { role: "user", content: user },
  ];
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await send(messages);
    let value: unknown;
    try {
      value = parseJson(text);
    } catch (e) {
      lastError = `JSON illisible : ${e instanceof Error ? e.message : String(e)}`;
      messages.push({ role: "assistant", content: text }, { role: "user", content: `Your reply is not valid JSON (${lastError}). Reply again with the JSON object only.` });
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    lastError = zodMessage(parsed.error);
    messages.push(
      { role: "assistant", content: text },
      { role: "user", content: `Your JSON does not match the expected shape: ${lastError}. Reply again with the corrected JSON object only.` },
    );
  }
  throw new DigestError(`Réponse du LLM invalide après une nouvelle tentative (${task}) : ${lastError}`);
}
