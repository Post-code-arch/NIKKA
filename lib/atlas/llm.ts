import OpenAI from "openai";
import { ATLAS_LLM_BASE, assertServer, getApiKey, isMockMode } from "./config";
import { ensureProxy, parseOrThrow } from "./http";
import { ChatCompletionSchema } from "./schemas";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object response (OpenAI `response_format`). */
  json?: boolean;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

let client: OpenAI | null = null;

export function getLlmClient(): OpenAI {
  assertServer();
  client ??= new OpenAI({ apiKey: getApiKey(), baseURL: ATLAS_LLM_BASE });
  return client;
}

export async function defaultLlmModel(): Promise<string> {
  const { resolveLlm } = await import("@/lib/models/registry");
  const m = resolveLlm()?.id ?? process.env.NIKKA_LLM_MODEL;
  if (!m) throw new Error("Aucun LLM : choisis-en un dans le catalogue (node Prompt enhancer) ou mets NIKKA_LLM_MODEL dans .env.local");
  return m;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  assertServer();
  if (isMockMode()) {
    const last = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    return { text: opts.json ? "{}" : `[mock] ${last.slice(0, 80)}`, model: "mock/llm" };
  }
  await ensureProxy();
  const model = opts.model ?? (await defaultLlmModel());
  const raw = await getLlmClient().chat.completions.create({
    model,
    messages,
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
  });
  const res = parseOrThrow(ChatCompletionSchema, raw, "chat.completions");
  return {
    text: res.choices[0].message.content ?? "",
    model: res.model ?? model,
    usage: {
      promptTokens: res.usage?.prompt_tokens,
      completionTokens: res.usage?.completion_tokens,
    },
  };
}
