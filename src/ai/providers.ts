import { logCall } from "@/server/llmLog";

// OpenAI-compatible chat providers, tried in order (LLM_PROVIDERS, default "groq,openrouter").
// Groq and OpenRouter speak the same API, so one fetch call covers both.

export type Role = "referee" | "narrator" | "agent";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Prompt tokens served from the provider's cache (cheaper), when the provider reports it. */
  cachedTokens?: number;
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
          // The agent gets its own model so its multi-step turns have their own rate-limit budget.
          agent: env("GROQ_AGENT_MODEL") ?? "openai/gpt-oss-20b",
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
        models: {
          narrator: model,
          referee: env("OPENROUTER_REFEREE_MODEL") ?? model,
          agent: env("OPENROUTER_AGENT_MODEL") ?? env("OPENROUTER_REFEREE_MODEL") ?? model,
        },
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
 * Reasoning models (gpt-oss, Claude Haiku 5.5) think before they answer, and the thinking counts
 * against max_tokens: left at their defaults they can spend the whole budget thinking and return no
 * text. Narration needs no reasoning, so it's off; the referee and agent think a little.
 */
function reasoningOptions(p: Provider, model: string, role: Role): Record<string, unknown> {
  if (p.name === "groq") return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {};
  if (p.name === "openrouter") return { reasoning: role === "narrator" ? { enabled: false } : { effort: "low" } };
  return {};
}

const isClaude = (model: string) => model.startsWith("anthropic/");

/**
 * The system prompt is the fixed part of every call, so it goes first and, for Claude models
 * (which only cache what is marked), carries a cache marker. OpenAI-style providers cache a
 * repeated prefix on their own where they support it.
 */
function systemMessage(model: string, text: string) {
  return { role: "system", content: isClaude(model) ? [{ type: "text", text, cache_control: { type: "ephemeral" } }] : text };
}

/**
 * Inside one agent turn every step resends the same game context (the first user message), so
 * for Claude it gets a second cache marker: steps 2+ read system prompt + context from cache.
 */
function cacheFirstUser(model: string, messages: AgentMessage[]) {
  if (!isClaude(model)) return messages;
  return messages.map((m, i) =>
    i === 0 && m.role === "user" ? { role: "user", content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] } : m,
  );
}

/** One HTTP call to a provider. Every call, success or failure, is metered in the LLM log. */
async function post(p: Provider, model: string, role: Role, body: Record<string, unknown>) {
  const started = performance.now();
  const meter = (ok: boolean, usage?: LlmUsage, error?: string) =>
    logCall({
      role,
      provider: p.name,
      model,
      ok,
      error,
      latencyMs: performance.now() - started,
      promptTokens: usage?.promptTokens ?? 0,
      cachedTokens: usage?.cachedTokens ?? 0,
      completionTokens: usage?.completionTokens ?? 0,
      costUsd: usage?.costUsd ?? 0,
    });
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}`, ...p.headers },
      body: JSON.stringify({ model, ...body, ...reasoningOptions(p, model, role), ...p.body }),
      signal: AbortSignal.timeout(Number(env("LLM_TIMEOUT_MS") ?? 12_000)),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`${p.name} ${res.status}: ${detail}`);
    }
    const data = await res.json();
    const usage: LlmUsage = {
      promptTokens: Number(data?.usage?.prompt_tokens ?? 0),
      completionTokens: Number(data?.usage?.completion_tokens ?? 0),
      costUsd: Number(data?.usage?.cost ?? 0),
      cachedTokens: Number(data?.usage?.prompt_tokens_details?.cached_tokens ?? 0),
    };
    const message = data?.choices?.[0]?.message;
    // An empty reply still cost money (e.g. a model that spent its budget thinking): meter it as a failure.
    const empty = !message || (!message.content && !message.tool_calls?.length);
    meter(!empty, usage, empty ? "empty response" : undefined);
    return { message, usage };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    meter(false, undefined, error);
    throw err;
  }
}

async function callProvider(p: Provider, req: ChatRequest): Promise<LlmResult> {
  const model = p.models[req.role];
  const { message, usage } = await post(p, model, req.role, {
    messages: [systemMessage(model, req.system), { role: "user", content: req.user }],
    max_tokens: req.maxTokens,
    // Newer Claude models reject a non-default temperature; everyone else gets the one asked for.
    ...(isClaude(model) ? {} : { temperature: req.temperature }),
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
  });
  const text: unknown = message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error(`${p.name}: empty response`);
  return { text, provider: p.name, model, usage };
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

// ---------------------------------------------------------------------------
// Tool calling (OpenAI-style), for the Game Master agent.

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string from the model: always validate before use. */
  arguments: string;
}

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolTurn {
  text: string | null;
  calls: ToolCall[];
  provider: string;
  model: string;
  usage: LlmUsage;
  /** The assistant message to append to the conversation before the tool results. */
  raw: AgentMessage;
}

/**
 * One model step with tools. `prefer` pins the provider that answered the previous step, so one
 * agent run doesn't hop between models mid-conversation; if it fails, the others are tried.
 */
export async function chatWithTools(req: {
  role: Role;
  system: string;
  messages: AgentMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  prefer?: string;
}): Promise<ToolTurn> {
  const list = providers().sort((a, b) => Number(b.name === req.prefer) - Number(a.name === req.prefer));
  if (!list.length) throw new Error("No LLM provider configured (set GROQ_API_KEY).");
  const errors: string[] = [];
  for (const p of list) {
    const model = p.models[req.role];
    try {
      const { message, usage } = await post(p, model, req.role, {
        messages: [systemMessage(model, req.system), ...cacheFirstUser(model, req.messages)],
        tools: req.tools.map((t) => ({ type: "function", function: t })),
        tool_choice: "auto",
        max_tokens: req.maxTokens,
      });
      if (!message) throw new Error(`${p.name}: no message`);
      const calls: ToolCall[] = (message.tool_calls ?? []).map((c: { id: string; function: { name: string; arguments: string } }) => ({
        id: c.id,
        name: c.function?.name ?? "",
        arguments: c.function?.arguments ?? "{}",
      }));
      const text = typeof message.content === "string" ? message.content : null;
      const raw: AgentMessage = {
        role: "assistant",
        content: text,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
      return { text, calls, provider: p.name, model, usage, raw };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.warn(`[llm] ${req.role} tools via ${p.name} failed: ${message}`);
    }
  }
  throw new Error(errors.join(" | "));
}
