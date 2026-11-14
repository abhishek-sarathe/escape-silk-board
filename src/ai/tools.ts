// The Game Master agent's tools. Every lookup tool is read-only: it reads the city's data and the
// game state and changes nothing (no time passes). The only way to act is take_action, whose
// arguments go through the same validation as the classic referee before the engine sees them.
import { formatClock, minutesLeft } from "@/game/clock";
import { busLink, busSpeed, isBus, type BusType } from "@/game/buses";
import { fixedFare, meterFare } from "@/game/engine";
import { describeWallet, spendable } from "@/game/money";
import { PLACES, edgeBetween, findPlace, kmToAirport, neighbors, pathKm, route, tollOn } from "@/game/map";
import { BUS_LANE, ITEMS, MAX_WALK_KM, SAMOSA_FARE_COVER, TRANSPORT, WALK_MIN_PER_KM } from "@/game/rules";
import { ACTION_KINDS, LOCATION_IDS, TRANSPORTS, type GameState, type LocationId, type Transport } from "@/game/types";
import type { ToolSpec } from "./providers";

const placeId = { type: "string", enum: [...LOCATION_IDS], description: "A place id." };
const HIREABLE = TRANSPORTS.filter((t) => t !== "lift");

export const TOOLS: ToolSpec[] = [
  {
    name: "look_around",
    description: "Read the player's situation: place, clock, cash, battery, bag, current ride, any driver quote, and the places next door.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "plan_trip",
    description: "Search one- and two-leg itineraries (any bus, bike taxi, cab, auto or walking) from the player's place to a destination. Returns the best few with total fare, rough minutes, and whether they fit the player's cash and the time left. Use for 'cheapest/fastest way to X'.",
    parameters: {
      type: "object",
      properties: {
        to: { ...placeId, description: "Destination (default airport)." },
        prefer: { type: "string", enum: ["cheapest", "fastest"] },
      },
      required: ["prefer"],
      additionalProperties: false,
    },
  },
  {
    name: "bus_options",
    description: "Real BMTC buses from a place (default: where the player is): route number, kind, destination, fare, how often they come, rough minutes. Optionally only those going to one place.",
    parameters: {
      type: "object",
      properties: {
        from: { ...placeId, description: "Where the buses leave from (optional; default the player's place)." },
        to: { ...placeId, description: "Only buses to this place (optional)." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "quote",
    description: "What a trip would cost and roughly how long it takes: auto (meter estimate; drivers ask more), cab or bike_taxi (app price, needs a living phone), or a kind of bus. A quote is not a booking.",
    parameters: {
      type: "object",
      properties: { transport: { type: "string", enum: HIREABLE }, to: placeId, from: { ...placeId, description: "Optional; default the player's place." } },
      required: ["transport", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "take_action",
    description: "Commit the ONE action the player is taking this turn. Call it exactly once, last. The game engine then decides what actually happens.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...ACTION_KINDS] },
        transport: { type: ["string", "null"], enum: [...HIREABLE, null] },
        destination: { type: ["string", "null"], description: "Place id, or null." },
        line: { type: ["string", "null"], description: 'Bus route number if the player names one ("500-D", "KIA-8").' },
        choice: { type: ["string", "null"], description: "For kind choose: the key of the DECISION option the player picked." },
        offer: { type: ["number", "null"] },
        offer_meter: { type: ["boolean", "null"] },
        accept_ask: { type: ["boolean", "null"] },
        price_check: { type: ["boolean", "null"] },
        items: { type: ["array", "null"], items: { type: "string" } },
        minutes: { type: ["number", "null"] },
        who: { type: ["string", "null"], enum: ["friend", "family", "airline", "other", null] },
        note: { type: "string", description: "Short verb phrase for what the player tries." },
        remember: { type: ["string", "null"], description: "Optional: one short note to yourself about this player for later turns." },
      },
      required: ["kind", "note"],
      additionalProperties: false,
    },
  },
];

export const LOOKUP_TOOLS = new Set(["look_around", "plan_trip", "bus_options", "quote"]);

/** Rough door-to-door minutes along a path before rain and city events: what the engine would charge. */
function rideMinutes(path: LocationId[], transport: Transport): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const edge = edgeBetween(path[i - 1], path[i])!;
    let m = edge.minutes * (isBus(transport) ? busSpeed(transport) : TRANSPORT[transport].speed);
    const lane = BUS_LANE.roads.some(([x, y]) => (x === path[i - 1] && y === path[i]) || (x === path[i] && y === path[i - 1]));
    if (isBus(transport) && lane) m *= BUS_LANE.factor;
    total += Math.max(3, Math.round(m));
  }
  return total;
}

const place = (id: LocationId) => PLACES[id].short;

function lookAround(s: GameState) {
  return {
    at: PLACES[s.location].name,
    clock: formatClock(s.minutes),
    minutes_until_checkin_closes: minutesLeft(s.minutes, s.grace ?? 0),
    cash: s.cash,
    upi: s.upi ?? 0,
    upi_usable: s.battery > 0,
    spendable_now: spendable(s),
    battery: s.battery,
    phone_works: s.battery > 0,
    bag: s.inventory.map((i) => ITEMS[i].label),
    raining: s.raining,
    ride: s.ride ? { in: TRANSPORT[s.ride.transport].label, line: s.ride.line ?? null, to: place(s.ride.destination) } : null,
    auto_driver_asking: s.quote ? { to: place(s.quote.destination), rupees: s.quote.ask } : null,
    km_to_airport: kmToAirport(s.location),
    next_door: neighbors(s.location).map((to) => {
      const km = edgeBetween(s.location, to)!.km;
      return { place: to, km, walk_minutes: km <= MAX_WALK_KM ? Math.round(km * WALK_MIN_PER_KM) : "too far to walk" };
    }),
  };
}

function busOptions(from: LocationId, to?: LocationId) {
  const out = [];
  for (const dest of LOCATION_IDS) {
    if (dest === from || (to && dest !== to)) continue;
    for (const type of ["bus", "ac_bus", "airport_bus"] as BusType[]) {
      const link = busLink(from, dest, type);
      if (!link) continue;
      const line = link.lines[0];
      out.push({
        to: dest,
        kind: TRANSPORT[type].label,
        transport: type,
        routes: link.lines.slice(0, 3).map((l) => l.name),
        fare: link.fare,
        comes_every_minutes: link.wait * 2,
        rough_minutes: link.wait + rideMinutes(line.path, type),
        via: line.path.map(place).join(" > "),
      });
    }
  }
  out.sort((a, b) => kmToAirport(a.to) - kmToAirport(b.to) || a.fare - b.fare);
  return out.length ? out.slice(0, 10) : { none: `No BMTC bus from ${place(from)}${to ? ` to ${place(to)}` : ""}.` };
}

function quote(s: GameState, transport: Transport, to: LocationId, from: LocationId = s.location) {
  if (to === from) return { error: "Already there." };
  if (isBus(transport)) {
    const link = busLink(from, to, transport);
    if (!link) return { none: `No ${TRANSPORT[transport].label} from ${place(from)} to ${place(to)}.` };
    return { fare: link.fare, routes: link.lines.slice(0, 3).map((l) => l.name), rough_minutes: link.wait + rideMinutes(link.lines[0].path, transport) };
  }
  const spec = TRANSPORT[transport];
  const path = route(from, to, transport)!;
  const minutes = spec.wait + rideMinutes(path, transport);
  const toll = tollOn(path, transport);
  if (transport === "auto") {
    return { meter_estimate: meterFare("auto", pathKm(path)) + toll, note: "Drivers ask more than the meter; haggling needed.", toll, rough_minutes: minutes };
  }
  if (spec.needsPhone && s.battery <= 0) return { error: `Phone is dead: no ${spec.label}.` };
  return { app_price: fixedFare(s.seed, transport, from, to), paid_by: "UPI only", upi_available: spendable(s, "upi"), toll, rough_minutes: minutes, needs_phone: spec.needsPhone };
}

interface Leg {
  how: string;
  to: LocationId;
  fare: number;
  minutes: number;
}

/** Every single-vehicle way to get from `from` to `to`, with fare and rough minutes. */
function legs(s: GameState, from: LocationId, to: LocationId): Leg[] {
  const out: Leg[] = [];
  for (const type of ["bus", "ac_bus", "airport_bus"] as BusType[]) {
    const link = busLink(from, to, type);
    if (link) out.push({ how: `${link.lines[0].name} (${TRANSPORT[type].label})`, to, fare: link.fare, minutes: link.wait + rideMinutes(link.lines[0].path, type) });
  }
  for (const t of ["bike_taxi", "cab", "auto"] as const) {
    if (TRANSPORT[t].needsPhone && s.battery <= 0) continue;
    const path = route(from, to, t)!;
    const fare = t === "auto" ? meterFare("auto", pathKm(path)) + tollOn(path, t) : fixedFare(s.seed, t, from, to)!;
    if (TRANSPORT[t].needsPhone && fare > spendable(s, "upi")) continue; // app rides are UPI only
    out.push({ how: t === "auto" ? "auto (meter estimate; expect to haggle)" : TRANSPORT[t].label, to, fare, minutes: TRANSPORT[t].wait + rideMinutes(path, t) });
  }
  const edge = edgeBetween(from, to);
  if (edge && edge.km <= MAX_WALK_KM) out.push({ how: "walk", to, fare: 0, minutes: Math.round(edge.km * WALK_MIN_PER_KM) });
  return out;
}

type Trip = { legs: Leg[]; fare: number; minutes: number };

/** Best one- and two-leg itineraries, ranked by cost or time. Estimates before rain and city events. */
function bestTrips(s: GameState, to: LocationId, prefer: "cheapest" | "fastest"): Trip[] {
  const left = minutesLeft(s.minutes, s.grace ?? 0);
  const budget = spendable(s) + (s.inventory.includes("samosa") ? SAMOSA_FARE_COVER : 0);
  const trips: Trip[] = [];
  for (const leg of legs(s, s.location, to)) trips.push({ legs: [leg], fare: leg.fare, minutes: leg.minutes });
  for (const mid of LOCATION_IDS) {
    if (mid === s.location || mid === to) continue;
    for (const a of legs(s, s.location, mid))
      for (const b of legs(s, mid, to)) trips.push({ legs: [a, b], fare: a.fare + b.fare, minutes: a.minutes + b.minutes });
  }
  // Cheapest means cheapest among trips that still make check-in, if any do.
  const usable = trips.filter((t) => t.fare <= budget);
  const inTime = usable.filter((t) => t.minutes <= left);
  const pool = prefer === "cheapest" && inTime.length ? inTime : usable;
  const rank = prefer === "cheapest" ? (t: Trip) => t.fare * 1000 + t.minutes : (t: Trip) => t.minutes * 1000 + t.fare;
  return pool.sort((x, y) => rank(x) - rank(y)).slice(0, 4);
}

function planTrip(s: GameState, to: LocationId, prefer: "cheapest" | "fastest") {
  if (to === s.location) return { error: "Already there." };
  const left = minutesLeft(s.minutes, s.grace ?? 0);
  const best = bestTrips(s, to, prefer);
  return {
    note: "Rough estimates before rain, hold-ups and haggling.",
    money: describeWallet(s),
    minutes_left: left,
    options: best.map((t) => ({
      steps: t.legs.map((l) => `${l.how} to ${place(l.to)} (₹${l.fare}, ~${l.minutes} min)`),
      total_fare: t.fare,
      rough_minutes: t.minutes,
      makes_checkin: t.minutes <= left,
    })),
  };
}

/** A trip's first step, phrased as something the player could type. */
function moveFor(leg: Leg): string {
  const to = place(leg.to);
  if (leg.how === "walk") return `Walk to ${to}`;
  if (leg.how.startsWith("auto")) return `Find an auto to ${to}`;
  if (leg.how === TRANSPORT.bike_taxi.label || leg.how === TRANSPORT.cab.label) return `Book a ${leg.how} to ${to} (₹${leg.fare})`;
  const route = leg.how.split(" (")[0]; // "500-D (BMTC bus)" -> "500-D"
  return `Take the ${route} to ${to} (₹${leg.fare})`;
}

/**
 * Up to three useful next moves for a player standing somewhere (no ride, no decision, no haggle):
 * the first step of the cheapest and fastest trips to the airport that still make check-in, plus the
 * best trip that doesn't. Plain code over the real data: no AI, no cost, and always true.
 */
export function nextMoves(s: GameState): string[] | undefined {
  if (s.status !== "playing" || s.pending || s.ride || s.quote || s.location === "airport") return undefined;
  const moves: string[] = [];
  for (const prefer of ["cheapest", "fastest"] as const) {
    for (const trip of bestTrips(s, "airport", prefer).slice(0, 2)) moves.push(moveFor(trip.legs[0]));
  }
  const unique = [...new Set(moves)];
  return unique.length ? unique.slice(0, 3) : undefined;
}

const asPlace = (v: unknown): LocationId | undefined =>
  typeof v === "string" ? ((LOCATION_IDS as readonly string[]).includes(v) ? (v as LocationId) : (findPlace(v) ?? undefined)) : undefined;

/** Run one read-only tool. Never mutates `s`. */
export function runLookup(s: GameState, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "look_around":
      return lookAround(s);
    case "plan_trip":
      return planTrip(s, asPlace(args.to) ?? "airport", args.prefer === "fastest" ? "fastest" : "cheapest");
    case "bus_options":
      return busOptions(asPlace(args.from) ?? s.location, asPlace(args.to));
    case "quote": {
      const t = args.transport as Transport;
      const to = asPlace(args.to);
      if (!HIREABLE.includes(t as (typeof HIREABLE)[number]) || !to) return { error: "quote needs a transport and a place id." };
      return quote(s, t, to, asPlace(args.from) ?? s.location);
    }
    default:
      return { error: `Unknown tool ${name}.` };
  }
}
