import { describe, expect, it } from "vitest";
import { blankAction } from "@/ai/localParser";
import { fixedFare, newGame, resolveTurn } from "./engine";
import { CHECKIN_CLOSES } from "./rules";
import { ACTION_KINDS, type Action, type GameState } from "./types";
import { toPublic } from "./view";

const act = (partial: Partial<Action>): Action => ({ ...blankAction("test"), ...partial });

function play(state: GameState, ...actions: Partial<Action>[]) {
  let s = state;
  const outcomes = [];
  for (const a of actions) {
    if (s.status !== "playing") break;
    const r = resolveTurn(s, act(a));
    s = r.state;
    outcomes.push(r.outcome);
  }
  return { state: s, outcomes };
}

describe("the world plays fair", () => {
  it("starts at Silk Board, 7:00 PM, 32%, ₹500, one samosa", () => {
    const s = newGame(1);
    expect(s).toMatchObject({ minutes: 0, battery: 32, cash: 500, location: "silk_board", inventory: ["samosa"] });
  });

  it("time moves forward on every kind of action, even refused ones", () => {
    for (const kind of ACTION_KINDS) {
      const { state } = resolveTurn(newGame(7), act({ kind }));
      expect(state.minutes, kind).toBeGreaterThan(0);
    }
  });

  it("never spends money you don't have", () => {
    const s = newGame(3);
    const { state, outcome } = resolveTurn(s, act({ kind: "hire", transport: "auto", destination: "airport", offer: 900 }));
    expect(state.cash).toBe(500);
    expect(outcome.refused.join(" ")).toMatch(/only have ₹500/);
  });

  it("can't afford an app ride to the airport straight from Silk Board", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(fixedFare(seed, "bike_taxi", "silk_board", "airport")!).toBeGreaterThan(500);
    }
  });

  it("a dead phone means no app rides and no calls", () => {
    const s = { ...newGame(4), battery: 0 };
    const bike = resolveTurn(s, act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" }));
    expect(bike.state.ride).toBeNull();
    expect(bike.state.cash).toBe(500);
    const call = resolveTurn(s, act({ kind: "call", who: "friend" }));
    expect(call.outcome.refused.join(" ")).toMatch(/dead/);
  });

  it("cheating changes nothing but the clock", () => {
    const s = newGame(5);
    const { state } = resolveTurn(s, act({ kind: "impossible", note: "teleport to the airport" }));
    expect(state).toMatchObject({ location: s.location, cash: s.cash, inventory: s.inventory, status: "playing" });
    expect(state.minutes).toBeGreaterThan(s.minutes);
  });

  it("you can't check in from Silk Board", () => {
    const { state, outcome } = resolveTurn(newGame(6), act({ kind: "check_in" }));
    expect(state.status).toBe("playing");
    expect(outcome.refused[0]).toMatch(/km away/);
  });

  it("you can't use items you don't have", () => {
    const { state, outcome } = resolveTurn(newGame(6), act({ kind: "use_item", items: ["umbrella"] }));
    expect(state.inventory).toEqual(["samosa"]);
    expect(outcome.refused[0]).toMatch(/don't have/);
  });
});

describe("travel", () => {
  it("moves one stretch per turn, and a ride keeps moving on later turns", () => {
    const s = newGame(11);
    const booked = resolveTurn(s, act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" }));
    expect(booked.state.ride).toEqual({ transport: "bike_taxi", destination: "hebbal" });
    expect(["koramangala", "hsr"]).toContain(booked.state.location);
    const next = resolveTurn(booked.state, act({ kind: "other", note: "sing" }));
    expect(next.state.location).not.toBe(booked.state.location);
  });

  it("refuses a long walk, so one misread move can't end the game", () => {
    const s = { ...newGame(13), location: "hebbal" as const, visited: ["hebbal" as const] };
    const { state, outcome } = resolveTurn(s, act({ kind: "walk", destination: "airport" }));
    expect(state).toMatchObject({ location: "hebbal", status: "playing" });
    expect(state.minutes).toBeLessThan(5);
    expect(outcome.refused[0]).toMatch(/10 km away/);
  });

  it("a refused walk doesn't throw you out of your ride", () => {
    const s = { ...newGame(14), location: "mg_road" as const, ride: { transport: "auto" as const, destination: "hebbal" as const } };
    const { state } = resolveTurn(s, act({ kind: "walk", destination: "hebbal" }));
    expect(state.location).toBe("hebbal"); // the auto kept going
  });

  it("still lets you walk a short stretch", () => {
    const { state } = resolveTurn(newGame(15), act({ kind: "walk", destination: "hsr" }));
    expect(state.location).toBe("hsr");
  });

  it("airport buses don't stop in Koramangala", () => {
    const s = { ...newGame(12), location: "koramangala" as const, visited: ["koramangala" as const] };
    const { state, outcome } = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "airport" }));
    expect(state.ride).toBeNull();
    expect(outcome.refused[0]).toMatch(/No airport bus/);
  });
});

describe("haggling", () => {
  it("the driver refuses the meter, and accepting his price works if you can pay", () => {
    const s = newGame(21);
    const asked = resolveTurn(s, act({ kind: "hire", transport: "auto", destination: "koramangala", offerMeter: true }));
    expect(asked.state.ride).toBeNull();
    expect(asked.state.quote).not.toBeNull();
    const ask = asked.state.quote!.ask;
    const deal = resolveTurn(asked.state, act({ kind: "hire", transport: "auto", destination: "koramangala", acceptAsk: true }));
    expect(deal.state.cash).toBe(500 - ask);
    expect(deal.state.location).toBe("koramangala");
  });

  it("asking for the meter is not treated as offering money you don't have", () => {
    const { state, outcome } = resolveTurn(newGame(3), act({ kind: "hire", transport: "auto", destination: "airport", offerMeter: true }));
    expect(outcome.refused).toEqual([]);
    expect(outcome.facts.join(" ")).toMatch(/refuses the meter|drives off/);
    expect(state.cash).toBe(500);
  });

  it("a ₹1 offer doesn't make the driver show his lowest price", () => {
    for (let seed = 0; seed < 200; seed++) {
      const asked = resolveTurn(newGame(seed), act({ kind: "hire", transport: "auto", destination: "mg_road" })).state;
      const lowball = resolveTurn(asked, act({ kind: "hire", transport: "auto", destination: "mg_road", offer: 1 })).state;
      if (lowball.quote) expect(lowball.quote.ask, `seed ${seed}`).toBeGreaterThan(asked.quote!.floor);
    }
  });

  it("when no haggle can work, the driver says so and points to the bus", () => {
    const far = resolveTurn(newGame(23), act({ kind: "hire", transport: "auto", destination: "airport" }));
    expect(far.outcome.facts.join(" ")).toMatch(/more than you're carrying.*Airport bus/);
    const near = resolveTurn(newGame(23), act({ kind: "hire", transport: "auto", destination: "hsr" }));
    expect(near.outcome.facts.join(" ")).not.toMatch(/more than you're carrying/);
  });

  it("checking a price books nothing and costs no money", () => {
    for (const transport of ["bike_taxi", "cab", "bus"] as const) {
      const { state, outcome } = resolveTurn(newGame(24), act({ kind: "hire", transport, destination: "hsr", priceCheck: true }));
      expect(state, transport).toMatchObject({ cash: 500, ride: null, location: "silk_board" });
      expect(outcome.facts.join(" "), transport).toMatch(/₹\d+/);
    }
    const auto = resolveTurn(newGame(24), act({ kind: "hire", transport: "auto", destination: "hsr", priceCheck: true, acceptAsk: true }));
    expect(auto.state).toMatchObject({ cash: 500, ride: null });
    expect(auto.state.quote).not.toBeNull();
  });

  it("the driver's floor price never reaches the browser", () => {
    const { state } = resolveTurn(newGame(22), act({ kind: "hire", transport: "auto", destination: "hebbal" }));
    expect(state.quote?.floor).toBeGreaterThan(0);
    expect(JSON.stringify(toPublic(state))).not.toContain('"floor"');
  });
});

describe("endings", () => {
  const atAirport = (battery: number, minutes: number): GameState => ({
    ...newGame(31),
    location: "airport",
    battery,
    minutes,
  });

  it("wins at the counter before 8:55", () => {
    const { state } = resolveTurn(atAirport(10, 90), act({ kind: "check_in" }));
    expect(state.status).toBe("won");
  });

  it("a dead phone costs you time at the gate", () => {
    const alive = resolveTurn(atAirport(10, 90), act({ kind: "check_in" })).state;
    const dead = resolveTurn(atAirport(0, 90), act({ kind: "check_in" })).state;
    expect(dead.minutes).toBeGreaterThan(alive.minutes);
  });

  it("loses once the clock passes 8:55", () => {
    const s = { ...newGame(32), minutes: CHECKIN_CLOSES - 2 };
    const { state } = resolveTurn(s, act({ kind: "wait", minutes: 10 }));
    expect(state.status).toBe("lost");
    expect(() => resolveTurn(state, act({ kind: "wait" }))).toThrow();
  });
});

describe("determinism and balance", () => {
  const smart: Partial<Action>[] = [
    { kind: "hire", transport: "bike_taxi", destination: "hebbal" },
    { kind: "continue" },
    { kind: "continue" },
    { kind: "hire", transport: "bus", destination: "airport" },
    { kind: "continue" },
    { kind: "check_in" },
  ];

  it("the same seed and the same moves give the same evening", () => {
    expect(play(newGame(99), ...smart).state).toEqual(play(newGame(99), ...smart).state);
  });

  it("is winnable most evenings with a smart plan, and never by bus all the way", () => {
    let smartWins = 0;
    let busWins = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (play(newGame(seed), ...smart).state.status === "won") smartWins++;
      const bus = play(
        newGame(seed),
        { kind: "hire", transport: "bus", destination: "airport" },
        ...Array(6).fill({ kind: "continue" }),
        { kind: "check_in" },
      );
      if (bus.state.status === "won") busWins++;
    }
    expect(smartWins).toBeGreaterThan(120);
    expect(busWins).toBe(0);
  });
});
