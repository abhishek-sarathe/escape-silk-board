// Mid-journey decisions: the city stops you and asks. Each encounter is offered at most once per game,
// rolled by code with its own RNG. The player picks an option (or ignores it and gets the fallback);
// the effects below are the rules, the narrator only tells them.
import { isBus } from "./buses";
import { PLACES, edgeBetween, kmToAirport, route } from "./map";
import { describeWallet, spendable } from "./money";
import type { Rng } from "./rng";
import { BATTERY, MAX_INVENTORY } from "./rules";
import type { Decision, GameState, LocationId, Transport } from "./types";

/** What an encounter may do to the world, provided by the engine. */
export interface Kit {
  rng: Rng;
  fact: (text: string) => void;
  refuse: (text: string) => void;
  minutes: (n: number) => void;
  pay: (amount: number) => void;
  board: (transport: Transport, destination: LocationId, wait: number, path?: LocationId[]) => void;
  battery: (delta: number) => void;
}

interface EncounterSpec {
  id: string;
  canHappen: (s: GameState) => boolean;
  offer: (s: GameState) => Omit<Decision, "id">;
  resolve: (s: GameState, key: string, k: Kit) => void;
}

const short = (id: LocationId) => PLACES[id].short;
const stopsLeft = (s: GameState) => (s.ride?.path ? s.ride.path.length - 1 : (route(s.location, s.ride?.destination ?? s.location, "auto")?.length ?? 1) - 1);
const onRoad = (s: GameState) => Boolean(s.ride && s.ride.transport !== "lift");

export const FRIEND = "Kiran";

export const ENCOUNTERS: EncounterSpec[] = [
  {
    id: "breakdown",
    canHappen: (s) => isBus(s.ride?.transport) && stopsLeft(s) >= 2,
    offer: (s) => ({
      prompt: `The ${s.ride!.line ?? "bus"} coughs, shudders and dies at ${short(s.location)}. The conductor stands up: "Engine problem. Everyone down, next one is coming."`,
      options: [
        { key: "share_auto", label: `Share an auto to ${short(s.ride!.destination)} with 3 strangers (₹60 each)` },
        { key: "wait_bus", label: "Wait for the next bus (~15 min)" },
        { key: "get_off", label: "Get off and figure it out myself" },
      ],
      fallback: "wait_bus",
    }),
    resolve: (s, key, k) => {
      const dest = s.ride!.destination;
      if (key === "share_auto") {
        if (spendable(s) < 60) {
          k.refuse(`The strangers want ₹60 each. You have ${describeWallet(s)}. You wait for the next bus instead.`);
          s.pendingDelay += 15;
          s.pendingDelayReason = "waiting for the next bus";
          return;
        }
        k.pay(60);
        s.ride = null;
        k.fact(`You squeeze into an auto with three strangers and a sack of onions. ₹60 each, straight to ${short(dest)}.`);
        k.board("auto", dest, 2);
      } else if (key === "get_off") {
        k.fact(`You step off at ${short(s.location)}. The bus, and your ticket, stay behind.`);
        s.ride = null;
      } else {
        s.pendingDelay += 15;
        s.pendingDelayReason = "waiting for the next bus";
        k.fact("You stay with the bus. Your ticket is good on the next one, whenever it comes.");
      }
    },
  },
  {
    id: "shortcut",
    canHappen: (s) => (s.ride?.transport === "auto" || s.ride?.transport === "cab") && stopsLeft(s) >= 1,
    offer: () => ({
      prompt: `The driver grins in the mirror: "Shortcut through the inside lanes, sir? ₹50 extra, 10 minutes saved. Guaranteed." He has said this to every passenger since 2009.`,
      options: [
        { key: "take_it", label: "Take the shortcut (₹50)" },
        { key: "main_road", label: "Main road only, anna" },
      ],
      fallback: "main_road",
    }),
    resolve: (s, key, k) => {
      if (key !== "take_it") return k.fact("You stay on the main road. The driver sighs like you've insulted his mother's cooking.");
      if (spendable(s) < 50) return k.refuse(`The shortcut costs ₹50. You have ${describeWallet(s)}. Main road it is.`);
      k.pay(50);
      if (k.rng() < 0.6) {
        s.shortcutBonus -= 10;
        k.fact("You pay ₹50 and the auto dives into a lane barely wider than it. It works.");
      } else {
        s.shortcutBonus += 8;
        k.fact("You pay ₹50 and the auto dives into a lane barely wider than it, which ends at a wedding procession.");
      }
    },
  },
  {
    id: "flood",
    canHappen: (s) => s.raining && onRoad(s),
    offer: () => ({
      prompt: "The underpass ahead is a lake. A scooter floats past, philosophically. Everyone stops.",
      options: [
        { key: "wait", label: "Wait for the water to drain (~12 min)" },
        { key: "detour", label: "Take the long detour (~6 min, +₹30 if you're in an auto or cab)" },
        { key: "get_off", label: "Get out and wade to the next stop" },
      ],
      fallback: "wait",
    }),
    resolve: (s, key, k) => {
      if (key === "detour") {
        const paid = s.ride && (s.ride.transport === "auto" || s.ride.transport === "cab") ? Math.min(30, spendable(s)) : 0;
        if (paid) k.pay(paid);
        s.pendingDelay += 6;
        s.pendingDelayReason = "the flood detour";
        k.fact(`The driver swings onto the detour${paid ? ` and adds ₹${paid} to the fare` : ""}.`);
      } else if (key === "get_off") {
        s.ride = null;
        k.minutes(5);
        k.fact("You get out, roll up your trousers and wade through. Your shoes will never forgive you.");
      } else {
        s.pendingDelay += 12;
        s.pendingDelayReason = "the flooded underpass";
        k.fact("You wait while the underpass slowly drains.");
      }
    },
  },
  {
    id: "passenger",
    canHappen: (s) => isBus(s.ride?.transport),
    offer: () => ({
      prompt: `The man next to you finishes a speakerphone call about his crypto startup and turns to you: "Bro. You look like an investor. Five minutes?"`,
      options: [
        { key: "listen", label: "Listen to the pitch" },
        { key: "earphones", label: "Put in earphones and stare out the window" },
        { key: "window", label: "Offer him your window seat to make him stop" },
      ],
      fallback: "earphones",
    }),
    resolve: (s, key, k) => {
      if (key === "listen") {
        s.shortcutBonus -= 5;
        k.fact("The pitch is terrible. But he drives this road every day, and between slides he tells the driver which lane moves. It helps.");
      } else if (key === "window") {
        if (s.inventory.length < MAX_INVENTORY) {
          s.inventory.push("chai");
          k.fact("He takes the window seat, delighted, and buys you a cutting chai from the next vendor out of gratitude.");
        } else k.fact("He takes the window seat, delighted, and finally goes quiet.");
      } else {
        k.battery(-3);
        k.fact("You put in earphones. Music costs a little battery; peace of mind is priceless.");
      }
    },
  },
  {
    id: "samosa",
    canHappen: (s) => s.inventory.includes("samosa") && s.location !== "airport",
    offer: () => ({
      prompt: "A kid stares at your cold samosa like it's treasure. His father, apologetic, holds up a power bank: \"Ten minutes of charge for the samosa? Or ₹30?\"",
      options: [
        { key: "charge", label: "Trade it for a power-bank charge" },
        { key: "sell", label: "Sell it for ₹30" },
        { key: "keep", label: "The samosa stays with me" },
      ],
      fallback: "keep",
    }),
    resolve: (s, key, k) => {
      if (key === "keep") return k.fact("You keep the samosa. The kid's disappointment will stay with you.");
      s.inventory.splice(s.inventory.indexOf("samosa"), 1);
      s.flags.push("traded:samosa");
      if (key === "charge") {
        k.battery(Math.round(10 * BATTERY.shopChargePerMin));
        k.fact("The samosa changes hands. The power bank gives your phone ten minutes of charge while the kid eats, blissful.");
      } else {
        s.cash += 30;
        k.fact("The samosa changes hands for ₹30. The kid looks at you like you've given him the moon.");
      }
    },
  },
  // --- BMTC chaos: the bus is never just a bus. ---
  {
    id: "depot",
    canHappen: (s) => isBus(s.ride?.transport) && s.ride?.transport !== "airport_bus" && stopsLeft(s) >= 2,
    offer: (s) => ({
      prompt: `At ${short(s.location)} the conductor stands up and announces: "Last stop! Depot! Everybody down!" The board in the window still says ${short(s.ride!.destination)}.`,
      options: [
        { key: "argue", label: `Argue: "It says ${short(s.ride!.destination)} on the board!"` },
        { key: "next_bus", label: "Wait for the next one (~12 min, same ticket)" },
        { key: "get_off", label: "Get off and find another way" },
      ],
      fallback: "next_bus",
    }),
    resolve: (s, key, k) => {
      if (key === "argue") {
        k.minutes(3);
        if (k.rng() < 0.45) return k.fact("Half the bus joins in. The driver wants his dinner too, and gives up: the bus carries on.");
        s.ride = null;
        return k.fact(`The conductor points at the depot gate and the conversation is over. You're on the pavement at ${short(s.location)}.`);
      }
      if (key === "get_off") {
        s.ride = null;
        return k.fact(`You step off at ${short(s.location)}, ticket still in hand, bus already reversing into the depot.`);
      }
      s.pendingDelay += 12;
      s.pendingDelayReason = "the wait for the next bus";
      k.fact("You wait at the depot gate. The next one honours your ticket, eventually.");
    },
  },
  {
    id: "checker",
    canHappen: (s) => isBus(s.ride?.transport),
    offer: () => ({
      prompt: `A ticket checker climbs aboard: "Tickets!" Your ticket was in your hand a moment ago. Now it isn't.`,
      options: [
        { key: "fine", label: "Pay the ₹50 fine" },
        { key: "search", label: "Search every pocket (~4 min)" },
        { key: "plead", label: `Plead: "Sir, my flight!"` },
      ],
      fallback: "fine",
    }),
    resolve: (s, key, k) => {
      const payFine = (why: string) => {
        if (spendable(s) >= 50) {
          k.pay(50);
          return k.fact(`${why} You pay the ₹50 fine, and the checker writes a receipt with great ceremony.`);
        }
        s.ride = null;
        k.fact(`${why} You can't pay the ₹50 fine (${describeWallet(s)}), so the checker walks you off the bus at ${short(s.location)}.`);
      };
      if (key === "search") {
        k.minutes(4);
        return k.rng() < 0.5 ? k.fact("It was folded inside your boarding pass printout all along. The checker nods, almost disappointed.") : payFine("Nothing.");
      }
      if (key === "plead") return k.rng() < 0.35 ? k.fact('The checker looks at your face, then at the traffic, and sighs: "Go. Catch your flight."') : payFine("He has heard it before.");
      payFine("You don't argue.");
    },
  },
  {
    id: "race",
    canHappen: (s) => isBus(s.ride?.transport) && stopsLeft(s) >= 1,
    offer: (s) => ({
      prompt: `Another ${s.ride!.line ?? "bus"} pulls up alongside. The two drivers look at each other. The whole bus goes quiet.`,
      options: [
        { key: "cheer", label: "Cheer him on!" },
        { key: "slow", label: "Ask him to slow down" },
      ],
      fallback: "cheer",
    }),
    resolve: (s, key, k) => {
      if (key === "slow") {
        s.pendingDelay += 2;
        s.pendingDelayReason = "a sulking driver";
        return k.fact("The driver lets the other bus go, and sulks for the rest of the stretch.");
      }
      s.shortcutBonus -= 7;
      if (s.inventory.length && k.rng() < 0.4) {
        const lost = s.inventory.splice(Math.floor(k.rng() * s.inventory.length), 1)[0];
        if (lost === "samosa") s.flags.push("lost:samosa");
        return k.fact(`The bus wins by a bumper, but the last hard brake sends your ${lost === "samosa" ? "cold samosa" : lost} flying down the aisle. Gone.`);
      }
      k.fact("The whole bus roars as your driver wins by a bumper. Even the conductor is smiling.");
    },
  },
  {
    id: "friend",
    canHappen: (s) => s.battery > 0 && !s.meet && Boolean(meetPlace(s)),
    offer: (s) => {
      const place = meetPlace(s)!;
      const eta = meetEta(s, place);
      return {
        prompt: `Your phone buzzes. It's ${FRIEND}, your old college friend: "Machaa! Driving to Devanahalli. I'll pass ${short(place)} in about ${eta} minutes. Want a lift to the airport? I can't wait long."`,
        options: [
          { key: "yes", label: `Yes! Meet ${FRIEND} at ${short(place)}` },
          { key: "no", label: "No thanks, I've got a plan" },
        ],
        fallback: "no",
      };
    },
    resolve: (s, key, k) => {
      k.battery(-BATTERY.call);
      if (key !== "yes") return k.fact(`You tell ${FRIEND} you've got it handled. ${FRIEND} says "Okay, all the best, machaa" in a tone that suggests doubt.`);
      const place = meetPlace(s);
      if (!place) return k.fact(`${FRIEND}'s call drops before you can agree on a place.`);
      s.meet = { place, by: s.minutes + meetEta(s, place) };
      k.fact(`${FRIEND} will wait at ${short(place)} until about ${meetEta(s, place)} minutes from now. Be there.`);
    },
  },
];

/** Somewhere ahead on the player's way to the airport (where a friend driving up would pass), not yet visited. */
function meetPlace(s: GameState): LocationId | null {
  const spots: LocationId[] = ["hebbal", "hennur", "yelahanka"];
  const fresh = (p: LocationId) => p !== s.location && !s.visited.includes(p) && kmToAirport(p) < kmToAirport(s.location);
  const way = route(s.location, "airport", "auto") ?? [];
  return way.find((p) => spots.includes(p) && fresh(p)) ?? spots.find(fresh) ?? null;
}

/** About how long a car takes to get there in tonight's traffic, plus slack: the friend waits that long. */
function meetEta(s: GameState, place: LocationId): number {
  const path = route(s.location, place, "auto") ?? [s.location];
  let minutes = 0;
  for (let i = 1; i < path.length; i++) minutes += edgeBetween(path[i - 1], path[i])!.minutes;
  return Math.round(minutes * 1.3) + 10;
}

export function findEncounter(id: string): EncounterSpec | undefined {
  return ENCOUNTERS.find((e) => e.id === id);
}
