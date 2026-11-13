import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("LLM call log", async () => {
  process.env.LLM_LOG_DB = path.join(os.tmpdir(), `llm-log-test-${process.pid}-${Date.now()}.sqlite`);
  const { logCall, usageSummary, withTurn } = await import("./llmLog");
  const call = { provider: "openrouter", model: "m", latencyMs: 100, promptTokens: 1000, cachedTokens: 800, completionTokens: 50 };

  it("meters calls per game and turn, including failures", async () => {
    await withTurn({ gameId: "g1", seed: 7, turn: 1 }, async () => {
      logCall({ ...call, role: "agent", ok: true, costUsd: 0.0002 });
      logCall({ ...call, role: "narrator", ok: false, error: "empty response", costUsd: 0.0001 });
    });
    logCall({ ...call, role: "agent", ok: true, costUsd: 0.0005 }); // outside a turn: no game id

    const s = usageSummary() as { total: Record<string, number>; games: Record<string, unknown>[] };
    expect(s.total).toMatchObject({ calls: 3, failed: 1, prompt_tokens: 3000, cached_tokens: 2400 });
    expect(s.total.cost_usd).toBeCloseTo(0.0008, 6);
    expect(s.games).toHaveLength(1);
    expect(s.games[0]).toMatchObject({ game_id: "g1", seed: 7, turns: 1, calls: 2 });
  });
});
