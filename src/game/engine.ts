// The rules of the city. Pure functions: (state, action) -> (new state, what happened).
// The LLM only ever proposes an Action; every number below is decided here.
import { formatClock } from "./clock";
import { PLACES, edgeBetween, kmToAirport, pathKm, route } from "./map";
import { between, rngFor, type Rng } from "./rng";
import {
  AUTO_ASK,
  AUTO_FLOOR,
  AUTO_PATIENCE,
  BATTERY,
  CHARGE_MINUTES,
  CHARGING_FEE,
  CHECKIN_CLOSES,
  CHECKIN_MINUTES,
  EVENT_CHANCE,
  ITEMS,
  MAX_EVENTS,
  MAX_INVENTORY,
  NO_PHONE_CHECKIN_PENALTY,
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
  const path = route(from, to, transport);
  if (!path) return null;
  return Math.round(meterFare(transport, pathKm(path)) * surge(seed, transport));
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
  const path = route(s.location, ride.destination, ride.transport);
  if (!path || path.length < 2) {
    s.ride = null;
    return 0;
  }
  const from = s.location;
  const next = path[1];
  const edge = edgeBetween(from, next)!;
  let minutes = edge.minutes * TRANSPORT[ride.transport].speed;
  if (s.raining) minutes *= ride.transport === "bike_taxi" ? RAIN.bike : RAIN.road;
  if (s.pendingDelay) ctx.facts.push(`${capitalise(s.pendingDelayReason ?? "a hold-up")} costs you ${s.pendingDelay} extra minutes.`);
  if (s.shortcutBonus < 0) ctx.facts.push("Your friend's shortcut actually works.");
  if (s.shortcutBonus > 0) ctx.facts.push("Your friend's shortcut turns out to be everyone's shortcut.");
  minutes = Math.max(3, Math.round(minutes + s.pendingDelay + s.shortcutBonus));
  s.pendingDelay = 0;
  s.pendingDelayReason = null;
  s.shortcutBonus = 0;

  moveTo(s, next);
  ctx.facts.push(`The ${label(ride.transport)} goes from ${short(from)} to ${short(next)}${s.raining ? " in the rain" : ""}: ${minutes} minutes.`);
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

function startRide(s: GameState, ctx: Ctx, transport: Transport, destination: LocationId, wait: number) {
  s.ride = { transport, destination };
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
  const transport = a.transport ?? "auto";
  const spec = TRANSPORT[transport];
  const dest = a.destination ?? "airport";
  if (dest === s.location) {
    ctx.refused.push(`You're already at ${short(dest)}.`);
    ctx.actionMinutes += 1;
    return;
  }
  const path = route(s.location, dest, transport);
  if (!path) {
    ctx.refused.push(
      `No airport bus stops at ${short(s.location)}. They run along the Outer Ring Road (HSR, Marathahalli, KR Puram), from MG Road, and up through Hebbal.`,
    );
    ctx.actionMinutes += 3;
    return;
  }
  if (transport === "auto") return haggle(s, a, ctx, rng, dest, path);

  if (spec.needsPhone && s.battery <= 0) {
    ctx.refused.push(`Your phone is dead. No app, no ${spec.label}.`);
    ctx.actionMinutes += 1;
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
  ctx.facts.push(
    spec.needsPhone
      ? `You book a ${spec.label} to ${short(dest)} for ₹${price}. It is "2 minutes away" for ${spec.wait} minutes.`
      : `You wait ${spec.wait} minutes and board the airport bus towards ${short(dest)}. Ticket: ₹${price}.`,
  );
  startRide(s, ctx, transport, dest, spec.wait);
}

function haggle(s: GameState, a: Action, ctx: Ctx, rng: Rng, dest: LocationId, path: LocationId[]) {
  const meter = meterFare("auto", pathKm(path));
  let quote = s.quote?.destination === dest ? s.quote : null;
  if (!quote) {
    quote = {
      destination: dest,
      ask: round10(meter * between(rng, ...AUTO_ASK)),
      floor: round10(meter * between(rng, ...AUTO_FLOOR)),
      patience: Math.round(between(rng, ...AUTO_PATIENCE)),
    };
    ctx.facts.push(
      `An auto driver agrees to consider ${short(dest)}. He wants ₹${quote.ask} and will not use the meter (it would show about ₹${meter}).`,
    );
    ctx.actionMinutes += TRANSPORT.auto.wait;
  } else {
    ctx.actionMinutes += 2;
  }
  s.quote = quote;

  const rawOffer = a.acceptAsk ? quote.ask : a.offerMeter ? meter : a.offer;
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
    takenItems.forEach((i) => removeItem(s, i));
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
  quote.ask = Math.min(quote.ask, Math.max(quote.floor, round10((quote.ask + cashOffer + itemValue) / 2)));
  ctx.facts.push(`The driver refuses ${describeOffer} and comes down to ₹${quote.ask}.`);
}

function walk(s: GameState, a: Action, ctx: Ctx) {
  if (s.ride) {
    ctx.facts.push(`You get out of the ${label(s.ride.transport)}.`);
    s.ride = null;
  }
  const dest = a.destination ?? "airport";
  if (dest === s.location) {
    ctx.refused.push(`You're already at ${short(dest)}.`);
    ctx.actionMinutes += 1;
    return;
  }
  const from = s.location;
  const next = route(from, dest, "walk")![1];
  const edge = edgeBetween(from, next)!;
  const soaked = s.raining && !s.inventory.includes("umbrella");
  const minutes = Math.round(edge.km * WALK_MIN_PER_KM * (soaked ? RAIN.walk : 1));
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
    ctx.facts.push("You flash the e-ticket on your phone at the gate and run for the counter.");
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
  apply: (s: GameState) => void;
}

const EVENTS: EventSpec[] = [
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
      s.pendingDelay += 12;
      s.pendingDelayReason = "the VIP convoy";
    },
  },
  {
    id: "breakdown",
    text: "A truck breaks down across two lanes ahead. Your next stretch by road will be 8 minutes slower.",
    canHappen: () => true,
    apply: (s) => {
      s.pendingDelay += 8;
      s.pendingDelayReason = "the broken-down truck";
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

function rollEvent(s: GameState): CityEvent | null {
  if (s.turn < 2 || s.location === "airport") return null;
  const rng = rngFor(s.seed, s.turn, "event");
  const seen = s.flags.filter((f) => f.startsWith("event:")).length;
  if (seen >= MAX_EVENTS || rng() >= EVENT_CHANCE) return null;
  const pool = EVENTS.filter((e) => !s.flags.includes(`event:${e.id}`) && e.canHappen(s));
  if (!pool.length) return null;
  const event = pool[Math.floor(rng() * pool.length)];
  s.flags.push(`event:${event.id}`);
  event.apply(s);
  return { id: event.id, text: event.text };
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

export function resolveTurn(prev: GameState, action: Action): TurnResult {
  if (prev.status !== "playing") throw new Error("The game is over.");
  const s: GameState = structuredClone(prev);
  s.turn += 1;
  const rng = rngFor(s.seed, s.turn, "action");
  const ctx: Ctx = { facts: [], refused: [], actionMinutes: 0, rideMinutes: 0, phoneCost: 0, batteryGain: 0, checkIn: false };
  const wasRiding = s.ride !== null;

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
  if (wasRiding && s.ride && action.kind !== "give_up") ctx.rideMinutes += advanceRide(s, ctx);

  // Time only moves forward, at least a minute per turn.
  const turnMinutes = Math.max(
    1,
    wasRiding ? Math.max(ctx.actionMinutes, ctx.rideMinutes) : ctx.actionMinutes + ctx.rideMinutes,
  );
  const startMinutes = s.minutes;
  s.minutes += turnMinutes;

  const drain = Math.floor(s.minutes / BATTERY.drainEvery) - Math.floor(startMinutes / BATTERY.drainEvery);
  const batteryBefore = prev.battery;
  s.battery = clamp(s.battery - ctx.phoneCost - drain + ctx.batteryGain, 0, 100);
  if (batteryBefore > 0 && s.battery === 0) ctx.facts.push("Your phone dies. No UPI, no apps, no calls.");
  else if (batteryBefore === 0 && s.battery > 0) ctx.facts.push("Your phone flickers back to life.");
  else if (batteryBefore > BATTERY.lowWarning && s.battery <= BATTERY.lowWarning)
    ctx.facts.push(`Low battery warning: ${s.battery}%.`);

  const event = s.status === "playing" && !ctx.checkIn ? rollEvent(s) : null;

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
