import { describe, expect, it } from "vitest";
import { blankAction } from "@/ai/localParser";
import { newGame, resolveTurn } from "./engine";
import type { Action, GameState } from "./types";
import { toPublic } from "./view";

const act = (p: Partial<Action>): Action => ({ ...blankAction("test"), ...p });

describe("the journey the route map draws", () => {
  it("records each stretch in order, with how you travelled and when you arrived", () => {
    let s: GameState = newGame(11);
    s = resolveTurn(s, act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" })).state;
    while (s.ride && s.status === "playing") s = resolveTurn(s, act({ kind: "continue" }), { oneStop: true }).state;

    const legs = s.journey ?? [];
    expect(legs.length).toBeGreaterThan(1);
    expect(legs[0].from).toBe("silk_board");
    expect(legs[0].mode).toBe("bike_taxi"); // later stretches may differ: the city can offer a lift
    expect(legs.map((l) => l.to)).toContain(s.location === "hebbal" ? "hebbal" : s.location);
    for (let i = 1; i < legs.length; i++) expect(legs[i].from).toBe(legs[i - 1].to); // a continuous line
    for (const l of legs) expect(l.at).toBeGreaterThan(0);
    expect(legs.map((l) => l.at!)).toEqual([...legs.map((l) => l.at!)].sort((a, b) => a - b)); // time only moves forward
  });

  it("pins city events where they happened, and sends both to the browser", () => {
    let s: GameState = newGame(3);
    for (let i = 0; i < 12 && s.status === "playing" && !(s.marks?.length); i++) {
      s = resolveTurn(s, act(s.pending ? { kind: "choose", choice: s.pending.fallback } : { kind: "wait", minutes: 5 })).state;
    }
    expect(s.marks?.length).toBeGreaterThan(0);
    const m = s.marks![0];
    expect(m.place).toBe("silk_board");
    expect(m.text.length).toBeGreaterThan(0);
    const pub = toPublic(s);
    expect(pub.marks).toEqual(s.marks);
    expect(pub.journey).toEqual(s.journey);
  });
});
