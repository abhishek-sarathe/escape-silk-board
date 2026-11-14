import { describe, expect, it } from "vitest";
import { totalMoney } from "./money";
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
  it("starts at Silk Board, 7:00 PM, 24%, ₹120 cash + ₹380 UPI, one samosa", () => {
    const s = newGame(1);
    expect(s).toMatchObject({ minutes: 0, battery: 24, cash: 120, upi: 380, location: "silk_board", inventory: ["samosa"] });
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
    expect(totalMoney(state)).toBe(500);
    expect(outcome.refused.join(" ")).toMatch(/only have ₹120 cash and ₹380 on UPI/);
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
    expect(totalMoney(bike.state)).toBe(500);
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
    expect(state).toMatchObject({ location: "silk_board", ride: null, cash: 120, upi: 380 });
    expect(outcome.refused[0]).toMatch(/No 281-AP bus stops at Silk Board/);
  });

  it("the cheap 281-AP really goes from Hebbal to the airport", () => {
    const s = { ...newGame(5), location: "hebbal" as const, visited: ["silk_board" as const, "hebbal" as const] };
    const { state } = resolveTurn(s, act({ kind: "hire", transport: "bus", destination: "airport" }));
    expect(state.ride).toMatchObject({ transport: "bus", line: "281-AP" });
    expect(state).toMatchObject({ cash: 120, upi: 340 }); // UPI goes first while the phone works
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
    expect(totalMoney(deal.state)).toBe(500 - ask);
    expect(deal.state.location).toBe("koramangala");
  });

  it("asking for the meter is not treated as offering money you don't have", () => {
    const { state, outcome } = resolveTurn(newGame(3), act({ kind: "hire", transport: "auto", destination: "airport", offerMeter: true }));
    expect(outcome.refused).toEqual([]);
    expect(outcome.facts.join(" ")).toMatch(/refuses the meter|drives off/);
    expect(totalMoney(state)).toBe(500);
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
      expect(state, transport).toMatchObject({ cash: 120, upi: 380, ride: null, location: "silk_board" });
      expect(outcome.facts.join(" "), transport).toMatch(/₹\d+/);
    }
    const auto = resolveTurn(newGame(24), act({ kind: "hire", transport: "auto", destination: "hsr", priceCheck: true, acceptAsk: true }));
    expect(auto.state).toMatchObject({ cash: 120, upi: 380, ride: null });
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

describe("the automatic ride", () => {
  it("moves one stop at a time, where a typed 'keep going' rides on until something happens", () => {
    const start = resolveTurn(newGame(11), act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" })).state;
    expect(start.ride).not.toBeNull();
    const oneStop = resolveTurn(start, act({ kind: "continue" }), { oneStop: true }).state;
    const allTheWay = resolveTurn(start, act({ kind: "continue" })).state;
    expect(oneStop.visited.length).toBe(start.visited.length + 1);
    expect(allTheWay.visited.length).toBeGreaterThanOrEqual(oneStop.visited.length);
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
    expect(smartWins).toBeGreaterThan(100); // bus waits and BMTC surprises vary: about half or better
    expect(busWins).toBeLessThan(100); // the KIA-8 from Silk Board loses more often than it wins; see balance.test.ts
  });
});

describe("the samosa saves a bus fare", () => {
  const atMg = (cash: number, inventory: GameState["inventory"] = ["samosa"]): GameState => ({
    ...newGame(11),
    location: "mg_road",
    visited: ["silk_board", "koramangala", "mg_road"],
    cash,
    upi: 0,
    inventory,
  });
  const bus = { ...blankAction("take the airport bus"), kind: "hire" as const, transport: "airport_bus" as const, destination: "airport" as const };

  it("a small shortfall: the conductor offers to take the samosa, and the player decides", () => {
    const fare = fixedFare(11, "airport_bus", "mg_road", "airport")!;
    const asked = resolveTurn(atMg(fare - 3), bus);
    // Nothing is taken yet: the conductor asks.
    expect(asked.state.ride).toBeNull();
    expect(asked.state.inventory).toContain("samosa");
    expect(asked.state.pending?.id).toBe("fare_samosa");
    expect(asked.outcome.refused).toEqual([]);

    const gave = resolveTurn(asked.state, act({ kind: "choose", choice: "give" })).state;
    expect(gave.ride?.transport).toBe("airport_bus");
    expect(gave.cash).toBe(0);
    expect(gave.inventory).not.toContain("samosa");
    expect(gave.flags).toContain("traded:samosa");

    const kept = resolveTurn(asked.state, act({ kind: "choose", choice: "keep" })).state;
    expect(kept.ride).toBeNull();
    expect(kept.inventory).toContain("samosa");
  });

  it("can't cover a big shortfall, and needs an actual samosa", () => {
    const fare = fixedFare(11, "airport_bus", "mg_road", "airport")!;
    expect(resolveTurn(atMg(fare - 80), bus).state.ride).toBeNull();
    expect(resolveTurn(atMg(fare - 3, []), bus).state.ride).toBeNull();
  });
});

describe("cash and UPI", () => {
  const atHebbal = (battery: number, cash: number, upi: number): GameState => ({
    ...newGame(5),
    location: "hebbal",
    visited: ["silk_board", "hebbal"],
    battery,
    cash,
    upi,
  });
  const kia = act({ kind: "hire", transport: "airport_bus", destination: "airport" });

  it("app rides need a working phone to book, but the rider takes cash: UPI first, then cash", () => {
    const fare = fixedFare(4, "bike_taxi", "silk_board", "hebbal")!;
    const s = { ...newGame(4), cash: 500, upi: 20 };
    const { state } = resolveTurn(s, act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" }));
    expect(state.ride?.transport).toBe("bike_taxi");
    expect(state).toMatchObject({ upi: 0, cash: 500 - (fare - 20) });
    const dead = resolveTurn({ ...s, battery: 0 }, act({ kind: "hire", transport: "bike_taxi", destination: "hebbal" }));
    expect(dead.state.ride).toBeNull(); // no phone, no app
  });

  it("a dead phone locks the UPI money: only cash pays", () => {
    const fare = fixedFare(5, "airport_bus", "hebbal", "airport")!;
    expect(resolveTurn(atHebbal(40, 20, fare), kia).state.ride?.transport).toBe("airport_bus");
    const dead = resolveTurn(atHebbal(0, 20, fare), kia);
    expect(dead.state.ride).toBeNull();
    expect(dead.outcome.refused.join(" ")).toMatch(/stuck in UPI: your phone is dead/);
  });

  it("the phone dying says how much money just went out of reach", () => {
    const s = { ...newGame(6), battery: 1 };
    const { outcome } = resolveTurn(s, act({ kind: "wait", minutes: 10 }));
    expect(outcome.facts.join(" ")).toMatch(/₹380 on UPI is out of reach/);
  });

  it("stranded with no money that works and no free way on: the evening ends", () => {
    const s: GameState = { ...newGame(7), location: "yelahanka", visited: ["silk_board", "hebbal", "yelahanka"], battery: 0, cash: 5, upi: 300, inventory: [] };
    const { state } = resolveTurn(s, act({ kind: "wait", minutes: 2 }));
    expect(state.status).toBe("lost");
    expect(state.endReason).toMatch(/^Stranded at Yelahanka/);
  });

  it("not stranded while a shop can charge the phone and unlock the UPI money", () => {
    const s: GameState = { ...newGame(7), location: "yelahanka", visited: ["silk_board", "hebbal", "yelahanka"], battery: 0, cash: 40, upi: 300, inventory: [] };
    expect(resolveTurn(s, act({ kind: "wait", minutes: 2 })).state.status).toBe("playing");
  });
});

describe("a fare you can't cover", () => {
  it("says what you have in both pots and exactly how much you're short", () => {
    // The real case: ₹495 bike taxi from Koramangala with ₹330 UPI + ₹120 cash = ₹450.
    const s: GameState = { ...newGame(4), location: "koramangala", visited: ["silk_board", "koramangala"], cash: 120, upi: 330 };
    const fare = fixedFare(4, "bike_taxi", "koramangala", "airport")!;
    const { state, outcome } = resolveTurn(s, act({ kind: "hire", transport: "bike_taxi", destination: "airport" }));
    if (fare > 450) {
      expect(state.ride).toBeNull();
      expect(outcome.refused.join(" ")).toContain(`You have ₹120 cash and ₹330 on UPI: ₹${fare - 450} short, even paying with both.`);
    } else {
      expect(state.ride?.transport).toBe("bike_taxi"); // cash + UPI together cover it
    }
  });
});
