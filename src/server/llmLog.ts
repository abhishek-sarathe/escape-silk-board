// Metering for every LLM call: who called which model, for which game and turn, how long it took,
// how many tokens (and how many came from cache), and what it cost. One SQLite file, using Node's
// built-in node:sqlite (no dependency). No prompts or player text are stored: this is a meter, not
// a transcript.
//
// Local dev: .data/llm-calls.sqlite (override with LLM_LOG_DB). On serverless hosts the disk is
// temporary, so point this module at a hosted database (Turso/libSQL, Postgres) for production:
// only this file needs to change.
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

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

/** Which game and turn the LLM calls in this request belong to. */
interface TurnContext {
  gameId: string;
  seed: number;
  turn: number;
}

const context = new AsyncLocalStorage<TurnContext>();

/** Run `fn` with every LLM call inside it attributed to this game and turn. */
export function withTurn<T>(ctx: TurnContext, fn: () => Promise<T>): Promise<T> {
  return context.run(ctx, fn);
}

let db: DatabaseSync | null | undefined;

function open(): DatabaseSync | null {
  if (db !== undefined) return db;
  if (process.env.LLM_LOG === "off") return (db = null);
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

/** Record one call. Never throws: metering must not break a turn. */
export function logCall(r: CallRecord): void {
  try {
    const d = open();
    if (!d) return;
    const ctx = context.getStore();
    d.prepare(
      `INSERT INTO llm_calls (game_id, seed, turn, role, provider, model, ok, error, latency_ms, prompt_tokens, cached_tokens, completion_tokens, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ctx?.gameId ?? null,
      ctx?.seed ?? null,
      ctx?.turn ?? null,
      r.role,
      r.provider,
      r.model,
      r.ok ? 1 : 0,
      r.error?.slice(0, 300) ?? null,
      Math.round(r.latencyMs),
      r.promptTokens,
      r.cachedTokens,
      r.completionTokens,
      r.costUsd,
    );
  } catch (err) {
    console.warn(`[llm log] write failed: ${err instanceof Error ? err.message : err}`);
  }
}

const TOTALS = `COUNT(*) AS calls, SUM(1 - ok) AS failed, ROUND(SUM(cost_usd), 6) AS cost_usd,
  SUM(prompt_tokens) AS prompt_tokens, SUM(cached_tokens) AS cached_tokens, SUM(completion_tokens) AS completion_tokens,
  ROUND(AVG(latency_ms)) AS avg_ms`;

/** Totals overall, per model and role, per day, and the most recent games. */
export function usageSummary(games = 20) {
  const d = open();
  if (!d) return { enabled: false };
  return {
    enabled: true,
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
