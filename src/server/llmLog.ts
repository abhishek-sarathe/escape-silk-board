// Metering for every LLM call: who called which model, for which game and turn, how long it took,
// how many tokens (and how many came from cache), and what it cost. No prompts or player text are
// stored: this is a meter, not a transcript.
//
// Two backends, same columns:
//  - Supabase (production): when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. A turn's rows are
//    queued in memory and written after the response is sent (the turn route calls flushTurn() inside
//    Next's after()), so logging never slows or breaks a turn. Table and summary function:
//    supabase/llm_calls.sql.
//  - SQLite (local dev): .data/llm-calls.sqlite via Node's built-in node:sqlite (override with
//    LLM_LOG_DB; on Vercel without Supabase, the function's temp dir, per instance).
// LLM_LOG=off turns both off.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";

export interface CallRecord {
  role: string;
  provider: string;
  model: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Which game and turn the LLM calls in this request belong to, and the rows waiting to be written. */
export interface TurnContext {
  gameId: string;
  seed: number;
  turn: number;
  /** Supabase rows for this turn, written by flushTurn(). */
  queue?: LogRow[];
  /** After the flush, late calls (a provider answering after the turn's time budget) write straight away. */
  flushed?: boolean;
}

/** One row of llm_calls, as both backends store it. */
export interface LogRow {
  game_id: string | null;
  seed: number | null;
  turn: number | null;
  role: string;
  provider: string;
  model: string;
  ok: boolean;
  error: string | null;
  latency_ms: number;
  prompt_tokens: number;
  cached_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

/** The slice of the Supabase client this module uses (so tests can pass a fake). */
export interface LogClient {
  from(table: string): { insert(rows: LogRow[]): PromiseLike<{ error: { message: string } | null }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const context = new AsyncLocalStorage<TurnContext>();
const off = () => process.env.LLM_LOG === "off";

/** Run `fn` with every LLM call inside it attributed to this game and turn. */
export function withTurn<T>(ctx: TurnContext, fn: () => Promise<T>): Promise<T> {
  ctx.queue ??= [];
  return context.run(ctx, fn);
}

// ---------------------------------------------------------------------------
// Supabase

let client: LogClient | null | undefined;

function remote(): LogClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  client = url && key ? (createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as LogClient) : null;
  return client;
}

/** For tests: use this client instead of a real one (null: no Supabase; undefined: read the env again). */
export function setLogClientForTests(c: LogClient | null | undefined) {
  client = c;
}

async function insertRows(rows: LogRow[]): Promise<void> {
  const c = remote();
  if (!c || !rows.length) return;
  try {
    const { error } = await c.from("llm_calls").insert(rows);
    if (error) console.warn(`[llm log] supabase insert failed: ${error.message}`);
  } catch (err) {
    console.warn(`[llm log] supabase insert failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Write this turn's queued rows. Meant for Next's after(); never throws. */
export async function flushTurn(ctx: TurnContext): Promise<void> {
  ctx.flushed = true;
  const rows = ctx.queue?.splice(0) ?? [];
  await insertRows(rows);
}

// ---------------------------------------------------------------------------
// SQLite

let db: DatabaseSync | null | undefined;

function open(): DatabaseSync | null {
  if (db !== undefined) return db;
  if (off()) return (db = null);
  try {
    // Loaded at runtime, not through the bundler (Turbopack can't resolve node:sqlite), so a
    // runtime without it simply skips logging.
    const sqlite = process.getBuiltinModule?.("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("node:sqlite is not available in this runtime");
    const { DatabaseSync } = sqlite;
    // On Vercel the app folder is read-only; the function's temp dir is writable (per instance, not durable).
    const file =
      process.env.LLM_LOG_DB ??
      (process.env.VERCEL ? path.join(os.tmpdir(), "llm-calls.sqlite") : path.join(process.cwd(), ".data", "llm-calls.sqlite"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec(`
      CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        game_id TEXT,
        seed INTEGER,
        turn INTEGER,
        role TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        ok INTEGER NOT NULL,
        error TEXT,
        latency_ms INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS llm_calls_game ON llm_calls (game_id);
      CREATE INDEX IF NOT EXISTS llm_calls_at ON llm_calls (at);
    `);
  } catch (err) {
    console.warn(`[llm log] disabled: ${err instanceof Error ? err.message : err}`);
    db = null;
  }
  return db;
}

// ---------------------------------------------------------------------------

function toRow(r: CallRecord, ctx: TurnContext | undefined): LogRow {
  return {
    game_id: ctx?.gameId ?? null,
    seed: ctx?.seed ?? null,
    turn: ctx?.turn ?? null,
    role: r.role,
    provider: r.provider,
    model: r.model,
    ok: r.ok,
    error: r.error?.slice(0, 300) ?? null,
    latency_ms: Math.round(r.latencyMs),
    prompt_tokens: r.promptTokens,
    cached_tokens: r.cachedTokens,
    completion_tokens: r.completionTokens,
    cost_usd: r.costUsd,
  };
}

/** Record one call. Never throws: metering must not break a turn. */
export function logCall(r: CallRecord): void {
  try {
    if (off()) return;
    const ctx = context.getStore();
    const row = toRow(r, ctx);
    if (remote()) {
      if (ctx?.queue && !ctx.flushed) ctx.queue.push(row);
      else void insertRows([row]);
      return;
    }
    const d = open();
    if (!d) return;
    d.prepare(
      `INSERT INTO llm_calls (game_id, seed, turn, role, provider, model, ok, error, latency_ms, prompt_tokens, cached_tokens, completion_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.game_id,
      row.seed,
      row.turn,
      row.role,
      row.provider,
      row.model,
      row.ok ? 1 : 0,
      row.error,
      row.latency_ms,
      row.prompt_tokens,
      row.cached_tokens,
      row.completion_tokens,
      row.cost_usd,
    );
  } catch (err) {
    console.warn(`[llm log] write failed: ${err instanceof Error ? err.message : err}`);
  }
}

const TOTALS = `COUNT(*) AS calls, SUM(1 - ok) AS failed, ROUND(SUM(cost_usd), 6) AS cost_usd,
  SUM(prompt_tokens) AS prompt_tokens, SUM(cached_tokens) AS cached_tokens, SUM(completion_tokens) AS completion_tokens,
  ROUND(AVG(latency_ms)) AS avg_ms`;

/** Totals overall, per model and role, per day, and the most recent games. */
export async function usageSummary(games = 20): Promise<Record<string, unknown>> {
  if (off()) return { enabled: false };
  const c = remote();
  if (c) {
    try {
      const { data, error } = await c.rpc("llm_usage_summary", { games });
      if (error) return { enabled: true, backend: "supabase", error: error.message };
      return { enabled: true, backend: "supabase", ...(data as Record<string, unknown>) };
    } catch (err) {
      return { enabled: true, backend: "supabase", error: err instanceof Error ? err.message : String(err) };
    }
  }
  const d = open();
  if (!d) return { enabled: false };
  return {
    enabled: true,
    backend: process.env.VERCEL ? "sqlite (this server instance only)" : "sqlite",
    total: d.prepare(`SELECT ${TOTALS} FROM llm_calls`).get(),
    byModel: d.prepare(`SELECT role, provider, model, ${TOTALS} FROM llm_calls GROUP BY role, provider, model ORDER BY cost_usd DESC`).all(),
    byDay: d.prepare(`SELECT substr(at, 1, 10) AS day, ${TOTALS} FROM llm_calls GROUP BY day ORDER BY day DESC LIMIT 14`).all(),
    games: d
      .prepare(
        `SELECT game_id, seed, MIN(at) AS started, MAX(turn) AS turns, ${TOTALS}
         FROM llm_calls WHERE game_id IS NOT NULL GROUP BY game_id ORDER BY started DESC LIMIT ?`,
      )
      .all(games),
  };
}
