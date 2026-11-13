// The rules of the city. Pure functions: (state, action) -> (new state, what happened).
// The LLM only ever proposes an Action; every number below is decided here.
import { formatClock } from "./clock";
import { busLink, busOptions, busSpeed, isBus, lineFrom, type BusLine, type BusType, type LineStop } from "./buses";
import { ENCOUNTERS, FRIEND, findEncounter, type Kit } from "./encounters";
import { PLACES, edgeBetween, kmToAirport, pathKm, route, tollOn } from "./map";
import { between, rngFor, type Rng } from "./rng";
import {
  AUTO_ASK,
  AUTO_FLOOR,
  AUTO_MAX_DROP,
  AUTO_PATIENCE,
  BATTERY,
  BUS_LANE,
  CHARGE_MINUTES,
  CHARGING_FEE,
  CHECKIN_CLOSES,
  CHECKIN_MINUTES,
  EVENT_CHANCE,
  FINAL_CALL_AT,
  FINAL_EVENT_CHANCE,
  FINAL_STRETCH,
  ITEMS,
  MAX_EVENTS,
  MAX_INVENTORY,
  MAX_WALK_KM,
  NO_PHONE_CHECKIN_PENALTY,
  SAMOSA_FARE_COVER,
  RAIN,
  START,
  TRANSPORT,
  WALK_MIN_PER_KM,
} from "./rules";
import type { Action, CityEvent, GameState, ItemId, LocationId, Transport, TurnResult } from "./types";

export function newGame(seed: number): GameState {
  return {
    version: 1,
    seed,
    turn: 0,
    minutes: 0,
    battery: START.battery,
    cash: START.cash,
    location: START.location,
    inventory: [...START.inventory],
    ride: null,
    quote: null,
    raining: false,
    pendingDelay: 0,
    pendingDelayReason: null,
    shortcutBonus: 0,
    flags: [],
    visited: [START.location],
    status: "playing",
    endReason: null,
    history: [],
    usage: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
  };
}

/** Scratchpad for one turn. */
interface Ctx {
  facts: string[];
  refused: string[];
  /** Time the player's own action takes. */
  actionMinutes: number;
  /** Time spent waiting for / riding in a vehicle. */
  rideMinutes: number;
  phoneCost: number;
  batteryGain: number;
  checkIn: boolean;
  /** A ride started this turn already moved its first stretch. */
  justBoarded: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round10 = (n: number) => Math.round(n / 10) * 10;
const short = (id: LocationId) => PLACES[id].short;
const label = (t: Transport) => TRANSPORT[t].label;
const itemList = (ids: ItemId[]) => ids.map((i) => ITEMS[i].label).join(" and ");

export function meterFare(transport: Transport, km: number): number {
  const spec = TRANSPORT[transport];
  return Math.max(spec.minFare, Math.round(spec.perKm * km));
}

/** Surge is rolled once per game per transport, so re-checking the app doesn't re-roll it. */
export function surge(seed: number, transport: Transport): number {
  const [lo, hi] = TRANSPORT[transport].surge;
  return Math.round(between(rngFor(seed, "surge", transport), lo, hi) * 100) / 100;
}

export function fixedFare(seed: number, transport: Transport, from: LocationId, to: LocationId): number | null {
  if (isBus(transport)) return busLink(from, to, transport)?.fare ?? null; // real BMTC fare
  const path = route(from, to, transport);
  if (!path) return null;
  return Math.round(meterFare(transport, pathKm(path)) * surge(seed, transport)) + tollOn(path, transport);
}

function pay(s: GameState, amount: number) {
  if (amount > s.cash) throw new Error(`Invariant: tried to pay ₹${amount} with ₹${s.cash}`);
  s.cash -= amount;
}

function removeItem(s: GameState, id: ItemId) {
  const i = s.inventory.indexOf(id);
  if (i >= 0) s.inventory.splice(i, 1);
}

function moveTo(s: GameState, to: LocationId) {
  s.location = to;
  s.quote = null; // the auto driver doesn't follow you
  if (!s.visited.includes(to)) s.visited.push(to);
}

/** Move the current ride one stretch along its route. Returns minutes taken. */
function advanceRide(s: GameState, ctx: Ctx): number {
  const ride = s.ride!;
  // A bus follows its real line; everything else takes the quickest road.
  const path = ride.path ?? route(s.location, ride.destination, ride.transport);
  if (!path || path.length < 2) {
    s.ride = null;
    return 0;
  }
  const from = s.location;
  const next = path[1];
  const edge = edgeBetween(from, next)!;
  let minutes = edge.minutes * (isBus(ride.transport) ? busSpeed(ride.transport) : TRANSPORT[ride.transport].speed);
  const busLane = isBus(ride.transport) && BUS_LANE.roads.some(([x, y]) => (x === from && y === next) || (x === next && y === from));
  if (busLane) minutes *= BUS_LANE.factor;
  if (s.raining) minutes *= ride.transport === "bike_taxi" ? RAIN.bike : RAIN.road;
  if (s.pendingDelay > 0) ctx.facts.push(`${capitalise(s.pendingDelayReason ?? "a hold-up")} costs you ${s.pendingDelay} extra minutes.`);
  if (s.pendingDelay < 0) ctx.facts.push(`${capitalise(s.pendingDelayReason ?? "a lucky break")} saves you ${-s.pendingDelay} minutes.`);
  if (s.shortcutBonus < 0) ctx.facts.push("Your friend's shortcut actually works.");
  if (s.shortcutBonus > 0) ctx.facts.push("Your friend's shortcut turns out to be everyone's shortcut.");
  minutes = Math.max(3, Math.round(minutes + s.pendingDelay + s.shortcutBonus));
  s.pendingDelay = 0;
  s.pendingDelayReason = null;
  s.shortcutBonus = 0;

  moveTo(s, next);
  if (ride.path) ride.path = ride.path.slice(1);
  ctx.facts.push(
    `The ${ride.line ? `${ride.line} ` : ""}${label(ride.transport)} goes from ${short(from)} to ${short(next)}${busLane ? " in the Ring Road bus lane" : ""}${s.raining ? " in the rain" : ""}: ${minutes} minutes.`,
  );
  if (ride.transport === "cab") {
    ctx.batteryGain += Math.round(minutes * BATTERY.cabChargePerMin);
    ctx.facts.push("Your phone charges off the cab's USB port on the way.");
  }
  if (next === ride.destination) {
    s.ride = null;
    ctx.facts.push(`You're dropped at ${PLACES[next].name}.`);
  }
  return minutes;
}

function startRide(s: GameState, ctx: Ctx, transport: Transport, destination: LocationId, wait: number, bus?: BusLine) {
  s.ride = bus ? { transport, destination, line: bus.name, path: [...bus.path] } : { transport, destination };
  ctx.justBoarded = true;
  ctx.rideMinutes += wait + advanceRide(s, ctx);
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Actions

function hire(s: GameState, a: Action, ctx: Ctx, rng: Rng) {
  if (s.ride) {
    ctx.refused.push(`You're already in the ${label(s.ride.transport)}. Get out first if you want to switch.`);
    return;
  }
  if (a.transport === "lift") {
    ctx.refused.push("Nobody is offering you a lift right now. You can't book a stranger's kindness.");
    ctx.actionMinutes += 2;
    return;
  }
  // Naming a route number ("500-D", "KIA-8") is asking for a bus, whatever the word for it was.
  if (a.line || isBus(a.transport)) return busHire(s, a, ctx);
  const transport = a.transport ?? "auto";
  const spec = TRANSPORT[transport];
  const dest = a.destination ?? "airport";
  if (dest === s.location) {
    ctx.refused.push(`You're already at ${short(dest)}.`);
    ctx.actionMinutes += 1;
    return;
  }
  const path = route(s.location, dest, transport)!;
  if (transport === "auto") return haggle(s, a, ctx, rng, dest, path);

  if (spec.needsPhone && s.battery <= 0) {
    ctx.refused.push(`Your phone is dead. No app, no ${spec.label}.`);
    ctx.actionMinutes += 1;
    return;
  }
  if (a.priceCheck) {
    // Looking is free: nothing is booked or paid, it just costs a minute (and a little battery on an app).
    const quoted = fixedFare(s.seed, transport, s.location, dest)!;
    if (spec.needsPhone) ctx.phoneCost += 1;
    ctx.actionMinutes += 1;
    ctx.facts.push(`The app shows a ${spec.label} to ${short(dest)} for ₹${quoted}, about ${spec.wait} minutes away. Nothing is booked yet.`);
    return;
  }
  if (spec.needsPhone) ctx.phoneCost += BATTERY.appBooking;
  if (transport === "bike_taxi" && s.raining && rng() < 0.5) {
    ctx.refused.push("It's raining. Every bike taxi rider nearby cancels on you.");
    ctx.actionMinutes += 4;
    return;
  }
  const price = fixedFare(s.seed, transport, s.location, dest)!;
  if (price > s.cash) {
    ctx.refused.push(`A ${spec.label} from ${short(s.location)} to ${short(dest)} costs ₹${price}. You have ₹${s.cash}.`);
    ctx.actionMinutes += 2;
    return;
  }
  pay(s, price);
  ctx.facts.push(`You book a ${spec.label} to ${short(dest)} for ₹${price}. It is "2 minutes away" for ${spec.wait} minutes.`);
  startRide(s, ctx, transport, dest, spec.wait);
}

const describeBus = (o: LineStop) => `${o.line.name} (${label(o.type)}) to ${short(o.to)}, ₹${o.link.fare}`;

/** Real BMTC buses: only lines that actually run from here to there, at their real fares. */
function busHire(s: GameState, a: Action, ctx: Ctx) {
  const here = s.location;
  const hints = () => {
    const opts = busOptions(here);
    return opts.length ? ` From ${short(here)}: ${opts.map(describeBus).join("; ")}.` : "";
  };
  let type: BusType = isBus(a.transport) ? a.transport : "bus";
  let dest = a.destination;
  let chosen: BusLine | undefined;

  if (a.line) {
    const stops = lineFrom(here, a.line);
    if (!stops.length) {
      ctx.refused.push(`No ${a.line.toUpperCase()} bus stops at ${short(here)}.${hints()}`);
      ctx.actionMinutes += 3;
      return;
    }
    // No destination named: ride the line as far towards the airport as it goes.
    const stop = dest ? stops.find((x) => x.to === dest) : stops[0];
    if (!stop) {
      const goes = [...new Set(stops.map((x) => short(x.to)))].join(", ");
      ctx.refused.push(`The ${stops[0].line.name} from ${short(here)} doesn't go to ${short(dest!)}. It goes to ${goes}.`);
      ctx.actionMinutes += 2;
      return;
    }
    ({ type, to: dest, line: chosen } = stop);
  }
  dest ??= "airport";
  if (dest === here) {
    ctx.refused.push(`You're already at ${short(dest)}.`);
    ctx.actionMinutes += 1;
    return;
  }
  const link = busLink(here, dest, type);
  if (!link) {
    ctx.refused.push(`No ${label(type)} goes from ${short(here)} to ${short(dest)}.${hints()}`);
    ctx.actionMinutes += 3;
    return;
  }
  const line = chosen ?? link.lines[0];
  const others = link.lines.filter((l) => l.name !== line.name).slice(0, 2).map((l) => l.name);
  const which = `the ${line.name}${others.length ? ` (or ${others.join(", ")})` : ""}`;
  if (a.priceCheck) {
    ctx.actionMinutes += 1;
    ctx.facts.push(
      `${capitalise(which)}, a ${label(type)}, goes to ${short(dest)} for ₹${link.fare}. One comes about every ${link.wait * 2} minutes. You haven't boarded.`,
    );
    return;
  }
  const shortBy = link.fare - s.cash;
  // A little short? The conductor accepts the samosa for the difference.
  if (shortBy > 0 && shortBy <= SAMOSA_FARE_COVER && s.inventory.includes("samosa")) {
    const paid = s.cash;
    pay(s, paid);
    removeItem(s, "samosa");
    s.flags.push("traded:samosa");
    ctx.facts.push(
      `You wait ${link.wait} minutes for ${which}. The ticket to ${short(dest)} is ₹${link.fare}; you have ₹${paid}. The conductor eyes your cold samosa and accepts it for the missing ₹${shortBy}. You board with ₹0 and no samosa.`,
    );
    startRide(s, ctx, type, dest, link.wait, line);
    return;
  }
  if (shortBy > 0) {
    ctx.refused.push(`The ${line.name} ${label(type)} from ${short(here)} to ${short(dest)} costs ₹${link.fare}. You have ₹${s.cash}.${hints()}`);
    ctx.actionMinutes += 2;
    return;
  }
  pay(s, link.fare);
  ctx.facts.push(`You wait ${link.wait} minutes and board ${which}, a ${label(type)} towards ${short(dest)}. Ticket: ₹${link.fare}.`);
  startRide(s, ctx, type, dest, link.wait, line);
}

function haggle(s: GameState, a: Action, ctx: Ctx, rng: Rng, dest: LocationId, path: LocationId[]) {
  const toll = tollOn(path, "auto");
  const meter = meterFare("auto", pathKm(path)) + toll;
  let quote = s.quote?.destination === dest ? s.quote : null;
  if (!quote) {
    quote = {
      destination: dest,
      ask: round10(meter * between(rng, ...AUTO_ASK)),
      floor: round10(meter * between(rng, ...AUTO_FLOOR)),
      patience: Math.round(between(rng, ...AUTO_PATIENCE)),
    };
    ctx.facts.push(
      `An auto driver agrees to consider ${short(dest)}. He wants ₹${quote.ask} and will not use the meter (it would show about ₹${meter}${toll ? `, with the ₹${toll} NH-44 toll` : ""}).`,
    );
    ctx.actionMinutes += TRANSPORT.auto.wait;
    // If no haggle can ever work, the driver says so, without naming his lowest price.
    const bagValue = s.inventory.reduce((sum, i) => sum + ITEMS[i].dealValue, 0);
    if (quote.floor > s.cash + bagValue) {
      ctx.facts.push(
        `He glances at your wallet and shakes his head: that is far more than you're carrying, however you bargain. "Go part of the way some other way, sir. Hebbal side. Airport bus comes there."`,
      );
    }
  } else {
    ctx.actionMinutes += 2;
  }
  s.quote = quote;

  const rawOffer = a.priceCheck ? null : a.acceptAsk ? quote.ask : a.offerMeter ? meter : a.offer;
  if (rawOffer === null) return; // just asking the price
  const cashOffer = Math.max(0, Math.round(rawOffer));

  const offeredItems = a.items.filter((i) => s.inventory.includes(i));
  const missing = a.items.filter((i) => !s.inventory.includes(i));
  if (missing.length) ctx.refused.push(`You don't have a ${itemList(missing)} to offer.`);
  const namedPrice = !a.acceptAsk && !a.offerMeter;
  if (namedPrice && cashOffer > s.cash) {
    ctx.refused.push(`You offer ₹${cashOffer}, but you only have ₹${s.cash}.`);
    return;
  }
  const itemValue = offeredItems.reduce((sum, i) => sum + ITEMS[i].dealValue, 0);
  const withItems = offeredItems.length ? ` plus your ${itemList(offeredItems)}` : "";
  const describeOffer = a.offerMeter ? `the meter${withItems}` : `₹${cashOffer}${withItems}`;

  if (cashOffer >= quote.ask || cashOffer + itemValue >= quote.floor) {
    const price = Math.min(cashOffer, quote.ask);
    if (price > s.cash) {
      ctx.refused.push(`The driver would go for ₹${price}. You have ₹${s.cash}.`);
      return;
    }
    const takenItems = price < quote.floor ? offeredItems : [];
    pay(s, price);
    takenItems.forEach((i) => {
      removeItem(s, i);
      s.flags.push(`traded:${i}`); // remembered for the ending ("samosa fate")
    });
    ctx.facts.push(
      `Deal: ₹${price}${takenItems.length ? ` plus your ${itemList(takenItems)}` : ""}. The auto sets off for ${short(dest)}.`,
    );
    s.quote = null;
    startRide(s, ctx, "auto", dest, 0);
    return;
  }

  quote.patience -= 1;
  if (quote.patience <= 0) {
    ctx.facts.push(`The driver hears ${describeOffer}, says "No, sir," and drives off. You'll need another auto.`);
    s.quote = null;
    return;
  }
  // He meets you halfway, but never drops more than AUTO_MAX_DROP in one round:
  // a silly ₹1 offer can't make him show his lowest price.
  const halfway = round10((quote.ask + cashOffer + itemValue) / 2);
  const smallestStep = round10(quote.ask * (1 - AUTO_MAX_DROP));
  quote.ask = Math.min(quote.ask, Math.max(quote.floor, halfway, smallestStep));
  ctx.facts.push(`The driver refuses ${describeOffer} and comes down to ₹${quote.ask}.`);
}

function walk(s: GameState, a: Action, ctx: Ctx) {
  const dest = a.destination ?? "airport";
  const from = s.location;

  // If already at the airport, running or walking to the counter/terminal means checking in!
  if (from === "airport" && (!a.destination || a.destination === "airport")) {
    checkIn(s, ctx);
    return;
  }

  const next = dest === from ? null : route(from, dest, "walk")![1];
  const edge = next ? edgeBetween(from, next)! : null;
  const soaked = s.raining && !s.inventory.includes("umbrella");
  const minutes = edge ? Math.round(edge.km * WALK_MIN_PER_KM * (soaked ? RAIN.walk : 1)) : 0;

  // Checked before anything moves: one misread "run to the counter" shouldn't start a game-ending walk.
  if (next && edge && edge.km > MAX_WALK_KM) {
    ctx.refused.push(`${short(next)} is ${edge.km} km away: ${minutes} minutes on foot. You'll need a ride.`);
    ctx.actionMinutes += 2;
    return;
  }
  if (s.ride) {
    ctx.facts.push(`You get out of the ${label(s.ride.transport)}.`);
    s.ride = null;
  }
  if (!next || !edge) {
    ctx.refused.push(`You're already at ${short(dest)}.`);
    ctx.actionMinutes += 1;
    return;
  }
  moveTo(s, next);
  ctx.actionMinutes += minutes;
  ctx.facts.push(`You walk ${edge.km} km from ${short(from)} to ${short(next)}${soaked ? ", getting soaked" : ""}: ${minutes} minutes.`);
}

function charge(s: GameState, a: Action, ctx: Ctx) {
  ctx.actionMinutes += 1;
  if (s.ride) {
    if (s.ride.transport === "cab") ctx.facts.push("You're already charging off the cab's USB port.");
    else ctx.refused.push(`There's no charger in a ${label(s.ride.transport)}.`);
    return;
  }
  const place = PLACES[s.location];
  if (!place.shops) {
    ctx.refused.push(`There's nowhere to plug in on ${place.short}.`);
    return;
  }
  const fee = CHARGING_FEE * place.priceMultiplier;
  if (fee > s.cash) {
    ctx.refused.push(`A shop will let you charge for ₹${fee}. You have ₹${s.cash}.`);
    return;
  }
  const minutes = clamp(Math.round(a.minutes ?? 10), ...CHARGE_MINUTES);
  const gain = Math.min(100 - s.battery, Math.round(minutes * BATTERY.shopChargePerMin));
  pay(s, fee);
  ctx.batteryGain += gain;
  ctx.actionMinutes += minutes - 1;
  ctx.facts.push(`A shop at ${place.short} lets you charge for ₹${fee}. ${minutes} minutes plugged in: +${gain}% battery.`);
}

function buy(s: GameState, a: Action, ctx: Ctx) {
  ctx.actionMinutes += 3;
  if (s.ride) {
    ctx.refused.push(`You can't shop from a moving ${label(s.ride.transport)}.`);
    return;
  }
  const place = PLACES[s.location];
  if (!place.shops) {
    ctx.refused.push(`Nobody is selling anything on ${place.short}.`);
    return;
  }
  if (!a.items.length) {
    ctx.refused.push(`Nobody at ${place.short} sells what you're after.`);
    return;
  }
  for (const id of a.items) {
    const item = ITEMS[id];
    const price = item.price * place.priceMultiplier;
    if (!item.buyable) ctx.refused.push(`Nobody sells a ${item.label} here.`);
    else if (s.inventory.length >= MAX_INVENTORY) ctx.refused.push("Your bag is full.");
    else if (price > s.cash) ctx.refused.push(`A ${item.label} costs ₹${price} here. You have ₹${s.cash}.`);
    else {
      pay(s, price);
      s.inventory.push(id);
      ctx.facts.push(`You buy a ${item.label} for ₹${price}.`);
    }
  }
}

function call(s: GameState, a: Action, ctx: Ctx, rng: Rng) {
  if (s.battery <= 0) {
    ctx.refused.push("Your phone is dead. No calls.");
    ctx.actionMinutes += 1;
    return;
  }
  ctx.phoneCost += BATTERY.call;
  ctx.actionMinutes += 4;
  switch (a.who) {
    case "friend":
      if (s.flags.includes("friend_called")) {
        ctx.facts.push("Your friend doesn't pick up this time.");
      } else {
        s.flags.push("friend_called");
        if (rng() < 0.4) {
          s.shortcutBonus -= 6;
          ctx.facts.push("Your friend explains a shortcut, clearly and completely. It sounds legitimate.");
        } else {
          s.shortcutBonus += 6;
          ctx.facts.push("Your friend starts explaining a shortcut and the call drops halfway. You'll try it anyway.");
        }
      }
      break;
    case "airline":
      ctx.facts.push("The airline's hold music plays. Check-in still closes at 8:55 PM, no exceptions.");
      break;
    case "family":
      ctx.facts.push("Family picks up. They can't help with the traffic, but they ask whether you've eaten.");
      break;
    default:
      ctx.facts.push(`You make a call (${a.note || "nobody useful"}). It doesn't change the traffic.`);
  }
}

function applyItem(s: GameState, a: Action, ctx: Ctx) {
  ctx.actionMinutes += 2;
  if (!a.items.length) {
    ctx.facts.push(`You try: ${a.note || "something"}. Nothing about your situation changes.`);
    return;
  }
  for (const id of a.items) {
    const item = ITEMS[id];
    if (!s.inventory.includes(id)) {
      ctx.refused.push(`You don't have a ${item.label}.`);
    } else if (id === "umbrella") {
      ctx.facts.push(s.raining ? "You open the umbrella. It helps." : "You open the umbrella. It isn't raining. People stare.");
    } else {
      removeItem(s, id);
      s.flags.push(`used:${id}`);
      ctx.facts.push(`You ${a.note || `use the ${item.label}`}. The ${item.label} is gone.`);
    }
  }
}

function checkIn(s: GameState, ctx: Ctx) {
  if (s.location !== "airport") {
    ctx.refused.push(`The check-in counter is still ${kmToAirport(s.location)} km away.`);
    ctx.actionMinutes += 1;
    return;
  }
  ctx.checkIn = true;
  if (s.battery > 0) {
    ctx.facts.push("You flash the e-ticket on your phone at the gate and run into the check-in queue.");
    ctx.actionMinutes += CHECKIN_MINUTES;
  } else {
    ctx.facts.push("Your phone is dead, so there's no e-ticket. The gate sends you to the airline desk for a printout first.");
    ctx.actionMinutes += CHECKIN_MINUTES + NO_PHONE_CHECKIN_PENALTY;
  }
}

// ---------------------------------------------------------------------------
// Random city events: rolled by code with their own RNG, so what you type can't change them.

interface EventSpec {
  id: string;
  text: string;
  canHappen: (s: GameState) => boolean;
  /** May return a more specific text than `text`. */
  apply: (s: GameState) => string | void;
}

const EVENTS: EventSpec[] = [
  // Help, not just hurdles: the city is chaotic, but people are kind.
  {
    id: "lift",
    text: "A stranger offers you a lift.",
    canHappen: (s) => !s.ride && !s.quote && s.location !== "airport",
    apply: (s) => {
      const next = route(s.location, "airport", "auto")![1];
      s.ride = { transport: "lift", destination: next, path: [s.location, next] };
      return `A techie in a hatchback, also late for something, pulls over and offers you a free lift to ${short(next)}. You get in.`;
    },
  },
  {
    id: "green_wave",
    text: "A traffic constable spots your trolley bag and waves your lane through three signals in a row. Your next stretch by road will be 8 minutes faster.",
    canHappen: (s) => s.ride !== null && s.pendingDelay === 0,
    apply: (s) => {
      s.pendingDelay -= 8;
      s.pendingDelayReason = "the constable's green wave";
    },
  },
  {
    id: "rain",
    text: "It starts pouring. Roads slow down, bike taxis get scarce, and walking without an umbrella is miserable.",
    canHappen: (s) => !s.raining,
    apply: (s) => {
      s.raining = true;
    },
  },
  {
    id: "convoy",
    text: "Police stop all traffic for a VIP convoy. Your next stretch by road will be 12 minutes slower.",
    canHappen: () => true,
    apply: (s) => {
      // Same delay, different cause each evening, so the city doesn't repeat itself.
      const [text, reason] = variant(s, "convoy", [
        ["Police stop all traffic for a VIP convoy. Your next stretch by road will be 12 minutes slower.", "the VIP convoy"],
        ["A political rally spills onto the road, flags and all. Your next stretch by road will be 12 minutes slower.", "the rally"],
        ["A wedding procession with a full brass band takes over the road. Your next stretch by road will be 12 minutes slower.", "the baraat"],
      ]);
      s.pendingDelay += 12;
      s.pendingDelayReason = reason;
      return text;
    },
  },
  {
    id: "breakdown",
    text: "A truck breaks down across two lanes ahead. Your next stretch by road will be 8 minutes slower.",
    canHappen: () => true,
    apply: (s) => {
      const [text, reason] = variant(s, "jam", [
        ["A truck breaks down across two lanes ahead. Your next stretch by road will be 8 minutes slower.", "the broken-down truck"],
        ["Two cars have a fender-bender and both drivers get out to argue. Your next stretch by road will be 8 minutes slower.", "the roadside argument"],
        ["A cow settles down in the middle lane and refuses to move. Your next stretch by road will be 8 minutes slower.", "the cow"],
        ["Metro construction closes a lane without warning. Your next stretch by road will be 8 minutes slower.", "the metro works"],
      ]);
      s.pendingDelay += 8;
      s.pendingDelayReason = reason;
      return text;
    },
  },
  {
    id: "chai",
    text: "A stranger stuck in the same jam hands you a cutting chai. Solidarity.",
    canHappen: (s) => s.inventory.length < MAX_INVENTORY,
    apply: (s) => {
      s.inventory.push("chai");
    },
  },
];

/** One of several flavours of the same happening, chosen by this evening's seed and turn. */
function variant<T>(s: GameState, key: string, options: T[]): T {
  return options[Math.floor(rngFor(s.seed, s.turn, "variant", key)() * options.length)];
}

/**
 * At each stop the city may throw something at you: a happening (rain, a convoy, a lift) or a
 * decision (a breakdown, a shortcut offer, a friend's call). More likely in the final stretch.
 * `stop` makes every stop of a long "keep going" ride its own roll.
 */
function rollEvent(s: GameState, stop = 0): CityEvent | null {
  if (s.turn < 2 || s.location === "airport" || s.pending) return null;
  const rng = rngFor(s.seed, s.turn, "event", stop);
  const seen = s.flags.filter((f) => f.startsWith("event:") || f.startsWith("decision:")).length;
  const chance = CHECKIN_CLOSES - s.minutes <= FINAL_STRETCH ? FINAL_EVENT_CHANCE : EVENT_CHANCE;
  if (seen >= MAX_EVENTS || rng() >= chance) return null;
  const pool = [
    ...EVENTS.filter((e) => !s.flags.includes(`event:${e.id}`) && e.canHappen(s)).map((e) => ({ kind: "event" as const, e })),
    ...ENCOUNTERS.filter((d) => !s.flags.includes(`decision:${d.id}`) && d.canHappen(s)).map((d) => ({ kind: "decision" as const, d })),
  ];
  if (!pool.length) return null;
  const pick = pool[Math.floor(rng() * pool.length)];
  if (pick.kind === "event") {
    s.flags.push(`event:${pick.e.id}`);
    const text = pick.e.apply(s);
    return { id: pick.e.id, text: text || pick.e.text };
  }
  s.flags.push(`decision:${pick.d.id}`);
  s.pending = { id: pick.d.id, ...pick.d.offer(s) };
  return { id: `decision:${pick.d.id}`, text: s.pending.prompt };
}

/** The friend's lift: be at the meeting place in time and they drive you to the airport. */
function checkMeet(s: GameState, ctx: Ctx) {
  if (!s.meet || s.status !== "playing") return;
  if (s.minutes > s.meet.by) {
    ctx.facts.push(`${FRIEND} texts: "Sorry machaa, couldn't wait any longer. All the best!"`);
    s.meet = null;
    return;
  }
  if (s.location !== s.meet.place) return;
  if (s.ride) ctx.facts.push(`You get out of the ${label(s.ride.transport)} at ${short(s.location)}.`);
  const path = route(s.location, "airport", "auto")!;
  s.ride = { transport: "lift", destination: "airport", path };
  s.meet = null;
  ctx.facts.push(`${FRIEND}'s car is idling at ${short(path[0])}, hazard lights on. "Get in, get in!" You're riding to the airport for free.`);
}

/** The airline's final-call SMS, once, as the deadline gets close. */
function finalCall(s: GameState, ctx: Ctx) {
  const left = CHECKIN_CLOSES - s.minutes;
  if (left > FINAL_CALL_AT || left <= 0 || s.flags.includes("final_call") || s.location === "airport") return;
  s.flags.push("final_call");
  if (s.battery > 0) ctx.facts.push(`SMS from the airline: "FINAL CALL. Check-in for ES 940 closes in ${left} minutes."`);
}

/** Answer (or ignore) the decision the city was waiting on. */
function resolveDecision(s: GameState, action: Action, ctx: Ctx, rng: Rng): boolean {
  const d = s.pending!;
  s.pending = null;
  // Accept the option's key, its number ("1" = first option) or its exact label: models and players use all three.
  const pick = action.choice?.trim().toLowerCase() ?? "";
  const chosen =
    action.kind === "choose"
      ? (d.options.find((o) => o.key === pick) ??
        (/^\d+$/.test(pick) ? d.options[Number(pick) - 1] : undefined) ??
        d.options.find((o) => o.label.toLowerCase() === pick))
      : undefined;
  const key = chosen?.key ?? d.fallback;
  if (!chosen) ctx.facts.push(`You let the moment pass (${d.options.find((o) => o.key === d.fallback)?.label.toLowerCase()}).`);
  const kit: Kit = {
    rng,
    fact: (t) => ctx.facts.push(t),
    refuse: (t) => ctx.refused.push(t),
    minutes: (n) => (ctx.actionMinutes += n),
    pay: (n) => pay(s, n),
    board: (t, dest, wait) => startRide(s, ctx, t, dest, wait),
    battery: (n) => (n < 0 ? (ctx.phoneCost -= n) : (ctx.batteryGain += n)),
  };
  findEncounter(d.id)?.resolve(s, key, kit);
  return Boolean(chosen);
}

// ---------------------------------------------------------------------------

function diffItems(before: ItemId[], after: ItemId[]): ItemId[] {
  const rest = [...after];
  for (const id of before) {
    const i = rest.indexOf(id);
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

/** `oneStop`: a "continue" moves just one stop (the automatic ride uses it, so each stop gets its own update). */
export function resolveTurn(prev: GameState, action: Action, opts: { oneStop?: boolean } = {}): TurnResult {
  if (prev.status !== "playing") throw new Error("The game is over.");
  const s: GameState = structuredClone(prev);
  s.turn += 1;
  const rng = rngFor(s.seed, s.turn, "action");
  const ctx: Ctx = { facts: [], refused: [], actionMinutes: 0, rideMinutes: 0, phoneCost: 0, batteryGain: 0, checkIn: false, justBoarded: false };

  // A decision is waiting: this turn either answers it, or does something else and gets its fallback.
  if (s.pending) {
    if (resolveDecision(s, action, ctx, rng)) ctx.actionMinutes += 1;
  } else if (action.kind === "choose") {
    ctx.refused.push("Nobody is asking you anything right now.");
    ctx.actionMinutes += 1;
  }
  const wasRiding = s.ride !== null;

  // At the airport the only way forward is the counter. Whatever a misread move comes back as
  // ("other", "wait", "hire"...), it resolves as the check-in, so the player can never get stuck
  // on the curb while the clock runs out. Shopping, charging and giving up stay their own moves.
  if (s.location === "airport" && !s.ride && !["buy", "charge", "give_up", "check_in"].includes(action.kind)) {
    action = { ...action, kind: "check_in" };
  }

  switch (action.kind) {
    case "hire":
      hire(s, action, ctx, rng);
      break;
    case "walk":
      walk(s, action, ctx);
      break;
    case "continue":
      if (!s.ride) {
        ctx.refused.push(`Nothing is carrying you. You're standing at ${short(s.location)}.`);
        ctx.actionMinutes += 2;
      }
      break;
    case "leave_ride":
      ctx.actionMinutes += 1;
      if (s.ride) {
        ctx.facts.push(`You get out of the ${label(s.ride.transport)} at ${short(s.location)}.`);
        s.ride = null;
      } else ctx.refused.push("You're not in a vehicle.");
      break;
    case "charge":
      charge(s, action, ctx);
      break;
    case "buy":
      buy(s, action, ctx);
      break;
    case "call":
      call(s, action, ctx, rng);
      break;
    case "use_item":
      applyItem(s, action, ctx);
      break;
    case "check_in":
      checkIn(s, ctx);
      break;
    case "choose":
      break; // handled above
    case "wait": {
      const minutes = clamp(Math.round(action.minutes ?? 5), 2, 30);
      ctx.actionMinutes += minutes;
      if (!s.ride) ctx.facts.push(`You wait ${minutes} minutes at ${short(s.location)}.`);
      break;
    }
    case "other":
      ctx.actionMinutes += clamp(Math.round(action.minutes ?? 4), 1, 10);
      ctx.facts.push(`You ${action.note || "do that"}. It doesn't change your situation.`);
      break;
    case "impossible":
      ctx.actionMinutes += 2;
      ctx.refused.push(`That can't happen: ${action.note || "the city doesn't work that way"}.`);
      break;
    case "give_up":
      ctx.actionMinutes += 1;
      ctx.facts.push("You give up on the flight.");
      s.status = "lost";
      s.endReason = "You gave up and went home.";
      break;
  }

  // A vehicle you're already in keeps moving, whatever else you do in it.
  if (wasRiding && s.ride && !ctx.justBoarded && action.kind !== "give_up") ctx.rideMinutes += advanceRide(s, ctx);

  // Time only moves forward, at least a minute per turn.
  let turnMinutes = Math.max(
    1,
    wasRiding ? Math.max(ctx.actionMinutes, ctx.rideMinutes) : ctx.actionMinutes + ctx.rideMinutes,
  );
  const startMinutes = s.minutes;
  s.minutes += turnMinutes;
  checkMeet(s, ctx);
  finalCall(s, ctx);
  let event = s.status === "playing" && !ctx.checkIn ? rollEvent(s) : null;

  // "Keep going" skips the boring part: ride on, stop by stop, until you arrive, something happens,
  // the city asks you something, your friend is there, or check-in closes.
  for (let stop = 1; action.kind === "continue" && !opts.oneStop && s.ride && !event && !s.pending && s.status === "playing" && s.minutes <= CHECKIN_CLOSES; stop++) {
    if (s.meet && s.ride.transport !== "lift" && s.location === s.meet.place) break;
    const m = advanceRide(s, ctx);
    turnMinutes += m;
    s.minutes += m;
    checkMeet(s, ctx);
    finalCall(s, ctx);
    event = rollEvent(s, stop);
  }

  const drain = Math.floor(s.minutes / BATTERY.drainEvery) - Math.floor(startMinutes / BATTERY.drainEvery);
  const batteryBefore = prev.battery;
  s.battery = clamp(s.battery - ctx.phoneCost - drain + ctx.batteryGain, 0, 100);
  if (batteryBefore > 0 && s.battery === 0) ctx.facts.push("Your phone dies. No UPI, no apps, no calls.");
  else if (batteryBefore === 0 && s.battery > 0) ctx.facts.push("Your phone flickers back to life.");
  else if (batteryBefore > BATTERY.lowWarning && s.battery <= BATTERY.lowWarning)
    ctx.facts.push(`Low battery warning: ${s.battery}%.`);

  // Arriving is checking in: dropped at departures, you run straight for the counter in the same turn,
  // so no turn (and no minutes) is lost typing "check in".
  if (s.status === "playing" && !ctx.checkIn && !s.ride && s.location === "airport" && prev.location !== "airport") {
    ctx.checkIn = true;
    const dash = s.battery > 0 ? CHECKIN_MINUTES : CHECKIN_MINUTES + NO_PHONE_CHECKIN_PENALTY;
    ctx.facts.push(
      s.battery > 0
        ? "You run from the drop-off straight into the check-in queue, e-ticket open on your phone."
        : "Your phone is dead, so there's no e-ticket. The gate sends you to the airline desk for a printout first.",
    );
    s.minutes += dash;
    turnMinutes += dash;
  }

  if (s.status === "playing") {
    if (ctx.checkIn) {
      if (s.minutes <= CHECKIN_CLOSES) {
        s.status = "won";
        s.endReason = `At the counter at ${formatClock(s.minutes)}, with ${CHECKIN_CLOSES - s.minutes} minutes to spare.`;
      } else {
        s.status = "lost";
        s.endReason = `You reach the counter at ${formatClock(s.minutes)}. It closed at 8:55 PM.`;
      }
    } else if (s.minutes > CHECKIN_CLOSES) {
      s.status = "lost";
      s.endReason =
        s.location === "airport"
          ? `It's ${formatClock(s.minutes)}. You made it to the airport, but check-in closed at 8:55 PM.`
          : `It's ${formatClock(s.minutes)} and you're still at ${short(s.location)}. Check-in closed at 8:55 PM.`;
    }
  }

  return {
    state: s,
    outcome: {
      facts: ctx.facts,
      refused: ctx.refused,
      event,
      delta: {
        minutes: turnMinutes,
        cash: s.cash - prev.cash,
        battery: s.battery - prev.battery,
        from: prev.location,
        to: s.location,
        itemsGained: diffItems(prev.inventory, s.inventory),
        itemsLost: diffItems(s.inventory, prev.inventory),
      },
    },
  };
}
