import { describe, expect, it } from "vitest";
import { blankAction } from "@/ai/localParser";
import { newGame, resolveTurn } from "./engine";
import type { Action, GameState } from "./types";

const act = (p: Partial<Action>): Action => ({ ...blankAction("test"), ...p });

/** Play a scripted evening (bus north, answer everything with the default) and list what the city did. */
function happenings(seed: number, avoid: string[] = []): string[] {
  let s: GameState = { ...newGame(seed), ...(avoid.length ? { avoid } : {}) };
  s = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "hennur" })).state;
  for (let i = 0; i < 12 && s.status === "playing"; i++) {
    const move = s.pending ? act({ kind: "choose", choice: s.pending.fallback }) : s.ride ? act({ kind: "continue" }) : act({ kind: "wait", minutes: 5 });
    s = resolveTurn(s, move).state;
  }
  return (s.marks ?? []).map((m) => m.id);
}

describe("the city doesn't repeat itself", () => {
  it("has a wide range of happenings across evenings", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80; seed++) happenings(seed).forEach((id) => seen.add(id));
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it("the free drink varies: chai, water or coffee", () => {
    const gifts = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      let s: GameState = newGame(seed);
      for (let i = 0; i < 12 && s.status === "playing"; i++) {
        const r = resolveTurn(s, s.pending ? act({ kind: "choose", choice: s.pending.fallback }) : act({ kind: "wait", minutes: 5 }));
        if (r.outcome.event?.id === "chai") gifts.add(r.outcome.delta.itemsGained.join(","));
        s = r.state;
      }
    }
    expect(gifts.size).toBeGreaterThan(1);
  });

  it("what a player saw recently comes up much less often in their next evening", () => {
    const count = (avoid: string[]) => {
      let n = 0;
      for (let seed = 0; seed < 200; seed++) if (happenings(seed, avoid).includes("chai")) n++;
      return n;
    };
    const normal = count([]);
    const avoided = count(["chai"]);
    expect(normal).toBeGreaterThan(10);
    expect(avoided).toBeLessThan(normal * 0.5);
  });

  it("a replay of the same evening is still the same evening", () => {
    expect(happenings(42)).toEqual(happenings(42));
  });
});
