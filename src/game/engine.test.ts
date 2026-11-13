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
    expect(outcome.refused[0]).toMatch(/9.6 km away/);
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

  it("refuses a bus that doesn't run, and names the real ones that do", () => {
    const s = { ...newGame(12), location: "koramangala" as const, visited: ["koramangala" as const] };
    const { state, outcome } = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "airport" }));
    expect(state.ride).toBeNull();
    expect(outcome.refused[0]).toMatch(/No BMTC bus goes from Koramangala to Airport/);
    expect(outcome.refused[0]).toMatch(/KIA-7A/); // the real airport bus from Koramangala
  });
});

describe("real BMTC buses", () => {
  it("charges real fares: ₹40 on the 500-series ordinary, far more on the Vayu Vajra", () => {
    expect(fixedFare(1, "bus", "silk_board", "hebbal")).toBe(40);
    expect(fixedFare(1, "airport_bus", "silk_board", "airport")).toBeGreaterThan(300);
    expect(fixedFare(1, "bus", "silk_board", "airport")).toBeNull(); // no ordinary bus does that trip
  });

  it("the KIA-8 follows its real route up the Outer Ring Road, not the shortest one", () => {
    const { state, outcome } = resolveTurn(newGame(5), act({ kind: "hire", transport: "airport_bus", destination: "airport" }));
    expect(state.ride).toMatchObject({ transport: "airport_bus", line: "KIA-8" });
    expect(state.location).toBe("hsr");
    expect(state.ride?.path).toEqual(["hsr", "marathahalli", "kr_puram", "hennur", "hebbal", "yelahanka", "airport"]);
    expect(outcome.facts.join(" ")).toMatch(/KIA-8/);
  });

  it("a named route with no destination rides as far towards the airport as it goes", () => {
    const { state } = resolveTurn(newGame(5), act({ kind: "hire", line: "500-D" }));
    // The 500-D runs Silk Board to Hebbal via Hennur; Hennur is the stop nearest the airport.
    expect(state.ride).toMatchObject({ transport: "bus", line: "500-D", destination: "hennur" });
  });

  it("a route that doesn't stop here is refused without moving", () => {
    const { state, outcome } = resolveTurn(newGame(5), act({ kind: "hire", line: "281-AP" }));
    expect(state).toMatchObject({ location: "silk_board", ride: null, cash: 500 });
    expect(outcome.refused[0]).toMatch(/No 281-AP bus stops at Silk Board/);
  });

  it("the cheap 281-AP really goes from Hebbal to the airport", () => {
    const s = { ...newGame(5), location: "hebbal" as const, visited: ["silk_board" as const, "hebbal" as const] };
    const { state } = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "airport" }));
    expect(state.ride).toMatchObject({ transport: "bus", line: "281-AP" });
    expect(state.cash).toBe(460);
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

  it("is winnable most evenings with a smart plan, and never by the KIA-8 all the way", () => {
    let smartWins = 0;
    let busWins = 0;
    for (let seed = 0; seed < 200; seed++) {
      if (play(newGame(seed), ...smart).state.status === "won") smartWins++;
      const bus = play(
        newGame(seed),
        { kind: "hire", transport: "airport_bus", destination: "airport" },
        ...Array(6).fill({ kind: "continue" }),
        { kind: "check_in" },
      );
      if (bus.state.status === "won") busWins++;
    }
    expect(smartWins).toBeGreaterThan(120);
    expect(busWins).toBeLessThan(100); // the KIA-8 from Silk Board loses more often than it wins; see balance.test.ts
  });
});

describe("the samosa saves a bus fare", () => {
  const atMg = (cash: number, inventory: GameState["inventory"] = ["samosa"]): GameState => ({
    ...newGame(11),
    location: "mg_road",
    visited: ["silk_board", "koramangala", "mg_road"],
    cash,
    inventory,
  });
  const bus = { ...blankAction("take the airport bus"), kind: "hire" as const, transport: "airport_bus" as const, destination: "airport" as const };

  it("covers a small shortfall: all your cash plus the samosa", () => {
    const fare = fixedFare(11, "airport_bus", "mg_road", "airport")!;
    const { state, outcome } = resolveTurn(atMg(fare - 3), bus);
    expect(state.ride?.transport).toBe("airport_bus");
    expect(state.cash).toBe(0);
    expect(state.inventory).not.toContain("samosa");
    expect(state.flags).toContain("traded:samosa");
    expect(outcome.refused).toEqual([]);
  });

  it("can't cover a big shortfall, and needs an actual samosa", () => {
    const fare = fixedFare(11, "airport_bus", "mg_road", "airport")!;
    expect(resolveTurn(atMg(fare - 80), bus).state.ride).toBeNull();
    expect(resolveTurn(atMg(fare - 3, []), bus).state.ride).toBeNull();
  });
});
