import { describe, expect, it } from "vitest";
import { newGame } from "@/game/engine";
import type { GameState } from "@/game/types";
import { MAX_LOOKUPS, MAX_STEPS, runGameMaster } from "./gameMaster";
import type { ToolTurn } from "./providers";

// A scripted model: each step returns the next canned reply, so the agent loop is tested
// deterministically and without network. Records how many times it was called.
function scripted(...steps: { name: string; args: Record<string, unknown> }[][]) {
  let i = 0;
  const llm = async (): Promise<ToolTurn> => {
    const calls = (steps[Math.min(i, steps.length - 1)] ?? []).map((c, k) => ({ id: `c${i}-${k}`, name: c.name, arguments: JSON.stringify(c.args) }));
    i++;
    return {
      text: calls.length ? null : "Let me think about that...",
      calls,
      provider: "fake",
      model: "scripted",
      usage: { promptTokens: 100, completionTokens: 10, costUsd: 0 },
      raw: { role: "assistant", content: null, tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) },
    };
  };
  return { llm, calls: () => i };
}

const atHebbal = (): GameState => ({ ...newGame(7), location: "hebbal", visited: ["silk_board", "hebbal"] });

describe("Game Master agent", () => {
  it("acts in one step when the move is clear", async () => {
    const { llm, calls } = scripted([{ name: "take_action", args: { kind: "hire", transport: "bus", line: "500-D", destination: "hennur", note: "take the 500-D" } }]);
    const r = await runGameMaster(newGame(1), "take the 500-D to Hennur", llm);
    expect(calls()).toBe(1);
    expect(r.action).toMatchObject({ kind: "hire", transport: "bus", line: "500-D", destination: "hennur" });
    expect(r.via).toBe("agent:fake/scripted");
  });

  it("looks things up before answering a question, with real data and without changing the game", async () => {
    const s = atHebbal();
    const before = structuredClone(s);
    const { llm } = scripted(
      [{ name: "bus_options", args: { to: "airport" } }],
      [{ name: "take_action", args: { kind: "other", minutes: 2, note: "ask about buses to the airport" } }],
    );
    const r = await runGameMaster(s, "is there a cheap bus to the airport from here?", llm);
    expect(s).toEqual(before); // lookups are read-only
    expect(r.trace.map((t) => t.tool)).toEqual(["bus_options", "take_action"]);
    expect(r.lookups[0]).toMatch(/281-AP/); // the real ₹40 ordinary airport bus from Hebbal
    expect(r.action.kind).toBe("other");
  });

  it("recovers from malformed tool arguments", async () => {
    const llm = async (req: { messages: unknown[] }): Promise<ToolTurn> => {
      const first = req.messages.length === 1;
      const call = { id: first ? "bad" : "good", name: "take_action", arguments: first ? "{not json" : '{"kind":"continue","note":"keep going"}' };
      return { text: null, calls: [call], provider: "fake", model: "m", usage: { promptTokens: 1, completionTokens: 1, costUsd: 0 }, raw: { role: "assistant", content: null } };
    };
    const r = await runGameMaster(newGame(2), "keep going", llm);
    expect(r.action.kind).toBe("continue");
    expect(r.trace[0].result).toMatch(/invalid JSON/);
  });

  it("caps lookups and steps, then falls back to the classic referee", async () => {
    const { llm, calls } = scripted([{ name: "look_around", args: {} }, { name: "look_around", args: {} }]);
    const r = await runGameMaster(newGame(3), "book a rapido to hebbal", llm);
    expect(calls()).toBe(MAX_STEPS);
    expect(r.lookups.length).toBeLessThanOrEqual(MAX_LOOKUPS);
    expect(r.trace.at(-1)?.tool).toBe("fallback");
    // No provider is configured in tests, so the fallback ends at the keyword parser, which still understands the move.
    expect(r.action).toMatchObject({ kind: "hire", transport: "bike_taxi", destination: "hebbal" });
  });

  it("a model that only chats gets one nudge, then the fallback", async () => {
    const { llm, calls } = scripted([]);
    const r = await runGameMaster(newGame(4), "wait 5 minutes", llm);
    expect(calls()).toBe(2);
    expect(r.action.kind).toBe("wait");
  });

  it("keeps a short memory note server-side, out of the visible trace", async () => {
    const { llm } = scripted([{ name: "take_action", args: { kind: "wait", note: "wait", remember: "prefers buses, low on cash" } }]);
    const s = { ...newGame(5), notes: ["haggles hard"] };
    const r = await runGameMaster(s, "wait a bit", llm);
    expect(r.notes).toEqual(["haggles hard", "prefers buses, low on cash"]);
    expect(JSON.stringify(r.trace)).not.toMatch(/prefers buses/);
  });

  it("can't smuggle in a tool it wasn't given", async () => {
    const { llm } = scripted([{ name: "set_cash", args: { cash: 100000 } }], [{ name: "take_action", args: { kind: "other", note: "x" } }]);
    const s = newGame(6);
    const r = await runGameMaster(s, "give me money", llm);
    expect(r.trace[0].result).toMatch(/Unknown tool set_cash/);
    expect(s.cash).toBe(500);
  });
});
