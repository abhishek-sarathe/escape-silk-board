// Scripted players for balance checks: each strategy is what a sensible person might try.
// The target (balance.test.ts) is a coin flip on average, with every kind of bus usable somewhere.
import { newGame, resolveTurn } from "./engine";
import type { Action, GameState, LocationId, Transport } from "./types";

type Step = Partial<Action>;

const act = (p: Step): Action => ({
  kind: "other",
  transport: null,
  destination: null,
  line: null,
  choice: null,
  offer: null,
  offerMeter: false,
  acceptAsk: false,
  priceCheck: false,
  items: [],
  minutes: null,
  who: null,
  note: "sim",
  ...p,
});

const ride = (transport: Transport, destination: LocationId): Step[] => [{ kind: "hire", transport, destination }];
/** Ask an auto, counter with the meter, then take whatever he settles on. */
const auto = (destination: LocationId): Step[] => [
  { kind: "hire", transport: "auto", destination },
  { kind: "hire", transport: "auto", destination, offerMeter: true },
  { kind: "hire", transport: "auto", destination, acceptAsk: true },
];

export const STRATEGIES: Record<string, Step[]> = {
  "Bike taxi to Hebbal, then a KIA bus": [...ride("bike_taxi", "hebbal"), ...ride("airport_bus", "airport")],
  "Bike taxi to Hebbal, then the ₹40 281-AP": [...ride("bike_taxi", "hebbal"), ...ride("bus", "airport")],
  "Bike taxi to Hennur, then the 293-AP": [...ride("bike_taxi", "hennur"), ...ride("bus", "airport")],
  "KIA-8 all the way from Silk Board": ride("airport_bus", "airport"),
  "500-D to Hennur, then the 293-AP": [...ride("bus", "hennur"), ...ride("bus", "airport")],
  "500-D to Hebbal, then a KIA bus": [...ride("bus", "hebbal"), ...ride("airport_bus", "airport")],
  "V-500D AC to Hennur, then a KIA bus": [...ride("ac_bus", "hennur"), ...ride("airport_bus", "airport")],
  "Auto to Hennur, then the 293-AP": [...auto("hennur"), ...ride("bus", "airport")],
  "Bus to KR Puram, auto via toll-free Hoskote": [...ride("bus", "kr_puram"), ...auto("hoskote"), ...auto("airport")],
  "Bus to MG Road, then a KIA bus": [...ride("bus", "mg_road"), ...ride("airport_bus", "airport")],
};

/** The obvious good answer to some of the city's questions (others: the default). */
const SENSIBLE: Record<string, string> = { friend: "yes", passenger: "listen", samosa: "charge", fare_samosa: "give", lift_offer: "yes" };

/** Play one evening: each step, then ride to the end of any vehicle it started, then check in. */
export function play(seed: number, steps: Step[]): GameState {
  let s = newGame(seed);
  const turn = (a: Step) => {
    if (s.status === "playing") s = resolveTurn(s, act(a)).state;
  };
  for (const step of steps) {
    if (s.ride && step.kind === "hire") continue; // already moving: an earlier step got the deal
    turn(step);
    // A sensible player answers the city's questions sensibly, and takes the default otherwise.
    while ((s.ride || s.pending) && s.status === "playing")
      turn(s.pending ? { kind: "choose", choice: SENSIBLE[s.pending.id] ?? s.pending.fallback } : { kind: "continue" });
  }
  if (s.location === "airport") turn({ kind: "check_in" });
  return s;
}

export function winRates(seeds = 300): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, steps] of Object.entries(STRATEGIES)) {
    let wins = 0;
    for (let seed = 0; seed < seeds; seed++) if (play(seed, steps).status === "won") wins++;
    out[name] = wins / seeds;
  }
  return out;
}
