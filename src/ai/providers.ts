// OpenAI-compatible chat providers, tried in order (LLM_PROVIDERS, default "groq,openrouter").
// Groq and OpenRouter speak the same API, so one fetch call covers both.

export type Role = "referee" | "narrator";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  usage: LlmUsage;
}

interface Provider {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: Record<Role, string>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function providers(): Provider[] {
  const available: Record<string, Provider | null> = {
    groq: (() => {
      const apiKey = env("GROQ_API_KEY");
      if (!apiKey) return null;
      // Two different models on purpose: Groq rate-limits each model separately, so the
      // referee and narrator don't eat into each other's free-tier budget.
      return {
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey,
        models: {
          narrator: env("GROQ_MODEL") ?? "qwen/qwen3.8-27b",
          referee: env("GROQ_REFEREE_MODEL") ?? "openai/gpt-oss-120b",
        },
      };
    })(),
    openrouter: (() => {
      const apiKey = env("OPENROUTER_API_KEY");
      const model = env("OPENROUTER_MODEL");
      if (!apiKey || !model) return null;
      return {
        name: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey,
        models: { narrator: model, referee: env("OPENROUTER_REFEREE_MODEL") ?? model },
        headers: { "X-Title": "Escape Silk Board" },
        body: { usage: { include: true } }, // returns the real USD cost per call
      };
    })(),
  };
  const order = (env("LLM_PROVIDERS") ?? "groq,openrouter").split(",").map((p) => p.trim().toLowerCase());
  return order.map((name) => available[name]).filter((p): p is Provider => Boolean(p));
}

export function hasProvider(): boolean {
  return providers().length > 0;
}

export interface ChatRequest {
  role: Role;
  system: string;
  user: string;
  json?: boolean;
  maxTokens: number;
  temperature: number;
}

/**
 * gpt-oss models think before they answer, and the thinking counts against max_tokens.
 * At their default effort they spend the whole budget thinking and return no text.
 */
function reasoningOptions(p: Provider, model: string): Record<string, unknown> {
  return p.name === "groq" && model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};
}

async function callProvider(p: Provider, req: ChatRequest): Promise<LlmResult> {
  const model = p.models[req.role];
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}`, ...p.headers },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      ...reasoningOptions(p, model),
      ...p.body,
    }),
    signal: AbortSignal.timeout(Number(env("LLM_TIMEOUT_MS") ?? 12_000)),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`${p.name} ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const text: unknown = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error(`${p.name}: empty response`);
  return {
    text,
    provider: p.name,
    model,
    usage: {
      promptTokens: Number(data?.usage?.prompt_tokens ?? 0),
      completionTokens: Number(data?.usage?.completion_tokens ?? 0),
      costUsd: Number(data?.usage?.cost ?? 0),
    },
  };
}

/**
 * Try each configured provider in order. `accept` lets the caller reject a response
 * (e.g. invalid JSON) and fall through to the next provider.
 */
export async function chat<T>(req: ChatRequest, accept: (r: LlmResult) => T): Promise<{ value: T; result: LlmResult }> {
  const list = providers();
  if (!list.length) throw new Error("No LLM provider configured (set GROQ_API_KEY).");
  const errors: string[] = [];
  for (const p of list) {
    try {
      const result = await callProvider(p, req);
      return { value: accept(result), result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.warn(`[llm] ${req.role} via ${p.name} failed: ${message}`);
    }
  }
  throw new Error(errors.join(" | "));
}
