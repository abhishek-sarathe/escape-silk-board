import { describe, expect, it } from "vitest";
import { totalMoney } from "./money";
import { blankAction } from "@/ai/localParser";
import { parseLocally } from "@/ai/localParser";
import { newGame, resolveTurn } from "./engine";
import { findEncounter } from "./encounters";
import type { Action, GameState } from "./types";

const act = (p: Partial<Action>): Action => ({ ...blankAction("test"), ...p });

/** A game paused on an encounter's decision, as the engine would leave it. */
function asked(id: string, base: Partial<GameState> = {}): GameState {
  const s: GameState = { ...newGame(9), turn: 3, ...base };
  s.pending = { id, ...findEncounter(id)!.offer(s) };
  s.flags.push(`decision:${id}`);
  return s;
}

const onKia8 = (): Partial<GameState> => ({
  location: "hsr",
  visited: ["silk_board", "hsr"],
  ride: { transport: "airport_bus", destination: "airport", line: "KIA-8", path: ["hsr", "marathahalli", "kr_puram", "hennur", "hebbal", "yelahanka", "airport"] },
});

describe("mid-ride decisions", () => {
  it("answering a breakdown by sharing an auto pays ₹60 and switches vehicles", () => {
    const { state, outcome } = resolveTurn(asked("breakdown", onKia8()), act({ kind: "choose", choice: "share_auto" }));
    expect(state.pending).toBeNull();
    expect(totalMoney(state)).toBe(440);
    expect(state.ride?.transport).toBe("auto");
    expect(outcome.facts.join(" ")).toMatch(/three strangers/);
  });

  it("ignoring a decision applies its fallback and still does what you asked", () => {
    const { state, outcome } = resolveTurn(asked("breakdown", onKia8()), act({ kind: "continue" }));
    expect(state.pending ?? null).toBeNull();
    expect(state.ride?.transport).toBe("airport_bus"); // stayed with the bus
    expect(outcome.facts.join(" ")).toMatch(/let the moment pass/);
  });

  it("a friend's lift: say yes, reach the place in time, ride to the airport free", () => {
    let s = asked("friend", { location: "kr_puram", visited: ["silk_board", "hsr", "marathahalli", "kr_puram"] });
    s = resolveTurn(s, act({ kind: "choose", choice: "yes" })).state;
    expect(s.meet?.place).toBe("hennur");
    const money = totalMoney(s);
    s = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "hennur" })).state;
    expect(s.location).toBe("hennur");
    expect(s.ride).toMatchObject({ transport: "lift", destination: "airport" });
    expect(totalMoney(s)).toBe(money - 30); // only the bus to Hennur was paid for
  });

  it("an option can be picked by key, by number or by its label", () => {
    for (const choice of ["yes", "1", "Yes! Meet Kiran at Hennur"]) {
      const s = asked("friend", { location: "kr_puram", visited: ["silk_board", "hsr", "marathahalli", "kr_puram"] });
      expect(resolveTurn(s, act({ kind: "choose", choice })).state.meet?.place, choice).toBe("hennur");
    }
  });

  it("choosing when nothing is asked is refused, not a crash", () => {
    const { state, outcome } = resolveTurn(newGame(1), act({ kind: "choose", choice: "yes" }));
    expect(state.status).toBe("playing");
    expect(outcome.refused[0]).toMatch(/Nobody is asking/);
  });

  it("the keyword fallback picks options by number or by their words", () => {
    const s = asked("breakdown", onKia8());
    expect(parseLocally(s, "2")).toMatchObject({ kind: "choose", choice: "wait_bus" });
    expect(parseLocally(s, "let's share the auto with them")).toMatchObject({ kind: "choose", choice: "share_auto" });
  });
});

describe("keep going skips the boring part", () => {
  it("rides several stops in one turn until something happens or you arrive", () => {
    let multiStop = 0;
    for (let seed = 0; seed < 40; seed++) {
      const s = { ...newGame(seed), ...onKia8(), turn: 3 };
      const { state } = resolveTurn(s, act({ kind: "continue" }));
      const stops = state.visited.length - s.visited.length;
      if (stops > 1) multiStop++;
      // It only stops early for a reason: arrival, an event or decision, or the deadline.
      if (state.ride && state.status === "playing") expect(state.pending || state.flags.some((f) => /^(event|decision):/.test(f))).toBeTruthy();
    }
    expect(multiStop).toBeGreaterThan(10);
  });
});
