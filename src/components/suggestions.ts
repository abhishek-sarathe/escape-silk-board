// Tap-to-play moves for the current situation, so nobody faces an empty text box.
// They are ordinary player text: the agent, referee and engine treat them like anything typed.
// Each turn shows the most useful move first, then a few drawn from a bigger pool. The draw is seeded
// by game and turn, so the buttons stay put while you read, and change when the turn does.
import { spendable } from "@/game/money";
import type { LocationId } from "@/game/types";
import type { PublicState } from "@/game/view";

/** Real BMTC moves worth suggesting from each place (see busData.json; the engine checks them anyway). */
const BUS_MOVES: Partial<Record<LocationId, string[]>> = {
  silk_board: ["Take the 500-D bus to Hennur", "Take the V-500D AC bus to Hebbal", "Take the KIA-8 straight to the airport"],
  hsr: ["Take the 500-D to Hennur", "Take the KIA-8 to the airport"],
  koramangala: ["Take the KIA-7A to the airport", "Take a BMTC bus to MG Road"],
  marathahalli: ["Take the 500-D to Hennur", "Take the KIA-8 to the airport"],
  mg_road: ["Take the KIA-14 to the airport", "Take a BMTC bus to Hennur"],
  kr_puram: ["Take the 500-D to Hennur", "Take the KIA-8 to the airport", "Take a bus to Hoskote"],
  hennur: ["Take the ₹40 293-AP bus to the airport", "Take the KIA-8 to the airport"],
  hebbal: ["Take the ₹40 281-AP bus to the airport", "Take the KIA-9 to the airport"],
  yelahanka: ["Take the 281-AP bus to the airport", "Take the KIA-9 to the airport"],
  hoskote: ["Haggle an auto to the airport, no toll on this side", "Find an auto to the airport"],
};

const ASK = [
  "What's the cheapest way to the airport from here?",
  "What's the fastest way to the airport from here?",
  "Which buses go from here?",
  "How much would a cab to the airport cost?",
];

const FLAVOUR = [
  "Buy a chai and think about my life",
  "Ask a stranger for directions",
  "Look for the Vayu Vajra bus stop",
  "Check the traffic on my phone",
];

const RIDING = [
  "Bhaiya, thoda jaldi!",
  "Ask how long it'll take",
  "Sing along to the radio",
  "Look out of the window",
  "Get out here",
];

/** Small deterministic PRNG (mulberry32) so the draw is stable for a given game and turn. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** First move, then `n` more drawn at random from the pool, without repeats. */
function pick(first: string[], pool: string[], n: number, seed: number): string[] {
  const r = rng(seed);
  const rest = [...new Set(pool.filter((m) => !first.includes(m)))];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...first, ...rest.slice(0, n)];
}

export function suggest(s: PublicState, more = 3): string[] {
  if (s.status !== "playing") return [];
  // The city is asking: the options are the moves.
  if (s.pending) return s.pending.options.map((o) => o.label);
  if (s.location === "airport") return ["Rush to the check-in counter", "Run inside to the gate", "Buy an overpriced coffee first"];

  const seed = s.seed * 131 + s.turn;
  const phone = s.battery > 0;
  const samosa = s.inventory.includes("samosa");
  const needs = [
    ...(phone && s.battery <= 15 && !s.ride ? ["Find a shop and charge my phone"] : []),
    ...(s.raining && !s.inventory.includes("umbrella") && !s.ride ? ["Buy an umbrella"] : []),
    ...(phone && !s.flags.includes("friend_called") ? ["Call my friend who knows a shortcut"] : []),
  ];

  if (s.ride) {
    const extra = [...RIDING, ...needs, ...(samosa ? ["Eat my cold samosa"] : []), ...(s.meet ? [`Get out at ${s.meet.place.replace("_", " ")}`] : [])];
    return pick(["Keep going"], extra, more, seed);
  }

  if (s.quote) {
    const money = spendable(s);
    const counter = Math.min(money, Math.round((s.quote.ask * 0.7) / 10) * 10);
    const lowball = Math.min(money, Math.round((s.quote.ask * 0.5) / 10) * 10);
    return pick(
      [`I offer ₹${counter}${samosa ? " and my samosa" : ""}`],
      [
        ...(s.quote.ask <= money ? [`Okay, ₹${s.quote.ask}. Chalo.`] : []),
        "Meter se chalo, anna",
        `₹${lowball}, final offer`,
        "Walk away and see if he follows",
        phone ? "Forget the auto. Book a bike taxi to Hebbal" : "Forget the auto. Take a BMTC bus to Hebbal",
      ],
      more,
      seed,
    );
  }

  const buses = BUS_MOVES[s.location] ?? [];
  const apps = phone
    ? ["Book a bike taxi to Hebbal", "Book a bike taxi to Hennur", "Check cab prices to the airport"].filter(
        (m) => !m.toLowerCase().endsWith(`to ${s.location}`), // never "to Hennur" while standing at Hennur
      )
    : [];
  if (s.turn === 0) return pick(["bhaiya, airport chaloge? meter se."], [...buses, ...apps, ...ASK, "Buy a chai and think about my life"], more, seed);

  // The most useful next step first: a real bus from here, else an auto.
  const first = buses.length ? [buses[0]] : ["Find an auto to the airport"];
  return pick(first, [...needs, ...buses, ...apps, ...ASK, ...FLAVOUR, "Find an auto to the airport"], more, seed);
}

/**
 * The buttons for a turn: up to two real next steps from the server's route planner first, then local
 * ideas, skipping anything shown last turn so the row changes as the evening does. Falls back to repeats
 * only when there is nothing new to offer.
 */
export function mixMoves(planned: string[], local: string[], lastShown: string[], size = 4): string[] {
  const seen = new Set(lastShown);
  const fresh = (m: string) => !seen.has(m);
  const fromPlan = planned.filter(fresh).slice(0, 2);
  if (!fromPlan.length && planned.length) fromPlan.push(planned[0]); // the best real move stays on offer
  const out = [...fromPlan];
  for (const m of [...local.filter(fresh), ...local]) {
    if (out.length >= size) break;
    if (!out.includes(m)) out.push(m);
  }
  return out;
}
