import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LogClient, LogRow } from "./llmLog";

const call = { provider: "openrouter", model: "m", latencyMs: 100, promptTokens: 1000, cachedTokens: 800, completionTokens: 50 };

describe("LLM call log: SQLite (local dev)", async () => {
  process.env.LLM_LOG_DB = path.join(os.tmpdir(), `llm-log-test-${process.pid}-${Date.now()}.sqlite`);
  const { logCall, usageSummary, withTurn, setLogClientForTests } = await import("./llmLog");
  beforeAll(() => setLogClientForTests(null)); // no Supabase in this suite

  it("meters calls per game and turn, including failures", async () => {
    await withTurn({ gameId: "g1", seed: 7, turn: 1 }, async () => {
      logCall({ ...call, role: "agent", ok: true, costUsd: 0.0002 });
      logCall({ ...call, role: "narrator", ok: false, error: "empty response", costUsd: 0.0001 });
    });
    logCall({ ...call, role: "agent", ok: true, costUsd: 0.0005 }); // outside a turn: no game id

    const s = (await usageSummary()) as { backend: string; total: Record<string, number>; games: Record<string, unknown>[] };
    expect(s.backend).toBe("sqlite");
    expect(s.total).toMatchObject({ calls: 3, failed: 1, prompt_tokens: 3000, cached_tokens: 2400 });
    expect(s.total.cost_usd).toBeCloseTo(0.0008, 6);
    expect(s.games).toHaveLength(1);
    expect(s.games[0]).toMatchObject({ game_id: "g1", seed: 7, turns: 1, calls: 2 });
  });
});

describe("LLM call log: Supabase (production), with a fake client", async () => {
  const { logCall, usageSummary, withTurn, flushTurn, setLogClientForTests } = await import("./llmLog");
  const inserted: LogRow[][] = [];
  let failInsert = false;
  const fake: LogClient = {
    from: (table) => {
      expect(table).toBe("llm_calls");
      return {
        insert: async (rows) => {
          if (failInsert) throw new Error("network down");
          inserted.push(rows);
          return { error: null };
        },
      };
    },
    rpc: async (fn, args) => {
      expect(fn).toBe("llm_usage_summary");
      return { data: { total: { calls: 2 }, games: [], argsSeen: args }, error: null };
    },
  };
  beforeAll(() => setLogClientForTests(fake));
  afterAll(() => setLogClientForTests(undefined));

  it("queues a turn's calls and writes them in one insert only when flushed (after the response)", async () => {
    const ctx = { gameId: "g2", seed: 9, turn: 3 };
    await withTurn(ctx, async () => {
      logCall({ ...call, role: "agent", ok: true, costUsd: 0.0003 });
      logCall({ ...call, role: "narrator", ok: true, costUsd: 0.0001 });
    });
    expect(inserted).toHaveLength(0); // nothing written during the turn
    await flushTurn(ctx);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toHaveLength(2);
    expect(inserted[0][0]).toMatchObject({ game_id: "g2", seed: 9, turn: 3, role: "agent", ok: true, prompt_tokens: 1000, cached_tokens: 800 });
  });

  it("stores no prompts or player text: only the meter columns", async () => {
    const row = inserted[0][0];
    expect(Object.keys(row).sort()).toEqual(
      ["cached_tokens", "completion_tokens", "cost_usd", "error", "game_id", "latency_ms", "model", "ok", "prompt_tokens", "provider", "role", "seed", "turn"].sort(),
    );
  });

  it("a call that lands after the flush is written straight away", async () => {
    const ctx = { gameId: "g3", seed: 1, turn: 1 };
    await withTurn(ctx, async () => {});
    await flushTurn(ctx);
    const before = inserted.length;
    await withTurn(ctx, async () => logCall({ ...call, role: "narrator", ok: true, costUsd: 0 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(inserted.length).toBe(before + 1);
  });

  it("a failing database never breaks a turn", async () => {
    failInsert = true;
    const ctx = { gameId: "g4", seed: 1, turn: 1 };
    await withTurn(ctx, async () => logCall({ ...call, role: "agent", ok: true, costUsd: 0 }));
    await expect(flushTurn(ctx)).resolves.toBeUndefined();
    failInsert = false;
  });

  it("the usage summary comes from the database function", async () => {
    const s = await usageSummary(5);
    expect(s).toMatchObject({ enabled: true, backend: "supabase", total: { calls: 2 }, argsSeen: { games: 5 } });
  });
});
