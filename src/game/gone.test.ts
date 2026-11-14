import { describe, expect, it } from "vitest";
import { blankAction, parseLocally } from "@/ai/localParser";
import { newGame, resolveTurn } from "./engine";
import { redirectGone } from "./gone";
import type { Action } from "./types";

const act = (p: Partial<Action>): Action => ({ ...blankAction("test"), ...p });

describe("rides that aren't an option tonight", () => {
  it("'Book a Bounce scooty' doesn't quietly become a bike taxi", () => {
    // What the AI did in a real game: read it as a bike taxi.
    const misread = act({ kind: "hire", transport: "bike_taxi", destination: "hebbal", note: "book a bounce scooty" });
    const fixed = redirectGone("Book a bounce scooty", misread);
    expect(fixed).toMatchObject({ kind: "other", transport: null, note: "look for a bounce" });
    const { state, outcome } = resolveTurn(newGame(4), fixed);
    expect(state.ride).toBeNull();
    expect(state.cash + (state.upi ?? 0)).toBe(500); // nothing paid
    expect(outcome.facts.join(" ")).toMatch(/stopped renting scooters back in 2023/);
  });

  it("Vogo, Yulu and the metro each get their own true story", () => {
    for (const [said, fact] of [
      ["get a vogo", /Vogo scooter/],
      ["rent a yulu", /25 km\/h/],
      ["take the metro", /Electronic City: the wrong way/],
    ] as const) {
      const { outcome } = resolveTurn(newGame(4), parseLocally(newGame(4), said));
      expect(outcome.facts.join(" "), said).toMatch(fact);
    }
  });

  it("a message that also names a real ride is left alone", () => {
    const rapido = act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" });
    expect(redirectGone("Bounce is dead, so book a Rapido to Hebbal", rapido)).toBe(rapido);
  });
});
