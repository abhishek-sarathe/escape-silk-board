// Every number that decides the game lives here, so balancing is one file.
import type { ItemId, Transport } from "./types";

export const START = {
  battery: 32,
  cash: 500,
  inventory: ["samosa"] as ItemId[],
  location: "silk_board" as const,
};

/** 8:55 PM, as minutes after 7:00 PM. Check-in closes 45 min before the 9:40 flight. */
export const CHECKIN_CLOSES = 115;

/**
 * Evening traffic: 7 PM drive time = empty-road time (OpenStreetMap routing) x this factor.
 * TomTom's 2025 index measures Bengaluru's evening rush at 115% congestion (x2.15) city-wide. At that,
 * almost nobody makes an 8:55 check-in from Silk Board (8% in simulation), so these are tuned down until
 * the scripted players in balance.ts win about half the time. Real distances; game-tuned traffic.
 */
export const TRAFFIC: Record<"city" | "arterial" | "highway", number> = { city: 1.3, arterial: 1.3, highway: 1.0 };

/**
 * The Outer Ring Road bus priority lane (Silk Board to KR Puram): buses on these stretches take
 * this fraction of their usual time.
 */
export const BUS_LANE = {
  factor: 0.6,
  roads: [
    ["silk_board", "hsr"],
    ["hsr", "marathahalli"],
    ["marathahalli", "kr_puram"],
  ] as const,
};

/** NH-44 toll on the way to the airport (the Hoskote side has none). Cars and autos pay it; two-wheelers don't. */
export const AIRPORT_TOLL = 120;
export const TOLL_PAYERS: readonly Transport[] = ["cab", "auto"];
export const FLIGHT_DEPARTS = 160;

export interface TransportSpec {
  label: string;
  /** Multiplier on road minutes. */
  speed: number;
  /** Minutes to find / wait for it before moving. */
  wait: number;
  perKm: number;
  minFare: number;
  /** Booked through an app: needs a living phone. */
  needsPhone: boolean;
  /** Price multiplier range at 7 PM (rolled once per game). */
  surge: [number, number];
}

export const TRANSPORT: Record<Transport, TransportSpec> = {
  auto: { label: "auto", speed: 1, wait: 3, perKm: 16, minFare: 30, needsPhone: false, surge: [1, 1] },
  cab: { label: "cab", speed: 1, wait: 8, perKm: 24, minFare: 100, needsPhone: true, surge: [1.2, 1.8] },
  bike_taxi: { label: "bike taxi", speed: 0.8, wait: 5, perKm: 10, minFare: 40, needsPhone: true, surge: [1.2, 1.6] },
  // Buses: fares, waits, routes and speeds come from real BMTC data (see buses.ts); these are fallbacks.
  bus: { label: "BMTC bus", speed: 1.1, wait: 5, perKm: 2, minFare: 6, needsPhone: false, surge: [1, 1] },
  ac_bus: { label: "Vajra AC bus", speed: 1.05, wait: 8, perKm: 3, minFare: 15, needsPhone: false, surge: [1, 1] },
  airport_bus: { label: "Vayu Vajra airport bus", speed: 1.28, wait: 10, perKm: 9, minFare: 20, needsPhone: false, surge: [1, 1] },
  lift: { label: "stranger's car", speed: 1, wait: 0, perKm: 0, minFare: 0, needsPhone: false, surge: [1, 1] },
};

/** Auto drivers: opening ask and the hidden lowest price, as multiples of the meter fare. */
export const AUTO_ASK: [number, number] = [1.5, 1.9];
export const AUTO_FLOOR: [number, number] = [1.05, 1.25];
export const AUTO_PATIENCE: [number, number] = [2, 3];
/** The most a driver cuts his asking price after one refused offer (12%). */
export const AUTO_MAX_DROP = 0.12;

export const WALK_MIN_PER_KM = 12;
/** Longer stretches are refused: no stretch over this can be walked in time to make the flight. */
export const MAX_WALK_KM = 4.5;

export const RAIN = { road: 1.25, bike: 1.6, walk: 1.4 };

export const BATTERY = {
  /** The phone loses 1% every N minutes just from being checked constantly. */
  drainEvery: 6,
  call: 3,
  appBooking: 4,
  /** % gained per minute plugged in at a shop. */
  shopChargePerMin: 1.5,
  /** % gained per minute riding in a cab with a charger. */
  cabChargePerMin: 0.5,
  lowWarning: 10,
};

export const CHARGING_FEE = 20;
export const CHARGE_MINUTES: [number, number] = [5, 30];

/**
 * The dash from the departures curb into the check-in queue. Short on purpose: the clock tells players
 * "time until check-in closes", so reaching the airport with a minute left has to be a win.
 */
export const CHECKIN_MINUTES = 1;
/** No phone means no e-ticket: queue at the airline desk for a printout first. */
export const NO_PHONE_CHECKIN_PENALTY = 12;

/** A bus conductor will take the samosa to cover a fare you're short on by at most this much. */
export const SAMOSA_FARE_COVER = 50;

/** Chance per stop that the city throws something at you (an event or a decision). */
export const EVENT_CHANCE = 0.5;
/** In the last FINAL_STRETCH minutes before check-in closes, things happen more often. */
export const FINAL_STRETCH = 30;
export const FINAL_EVENT_CHANCE = 0.7;
/** The airline's "final call" SMS arrives when this many minutes are left. */
export const FINAL_CALL_AT = 20;
/** Events plus decisions per game. */
export const MAX_EVENTS = 5;
export const MAX_INVENTORY = 6;
export const HISTORY_LIMIT = 6;

export interface ItemSpec {
  label: string;
  price: number;
  /** What it's worth thrown into a haggle. */
  dealValue: number;
  buyable: boolean;
  consumable: boolean;
}

export const ITEMS: Record<ItemId, ItemSpec> = {
  samosa: { label: "cold samosa", price: 20, dealValue: 30, buyable: false, consumable: true },
  chai: { label: "cutting chai", price: 15, dealValue: 15, buyable: true, consumable: true },
  coffee: { label: "filter coffee", price: 25, dealValue: 20, buyable: true, consumable: true },
  water: { label: "water bottle", price: 20, dealValue: 10, buyable: true, consumable: true },
  umbrella: { label: "umbrella", price: 180, dealValue: 60, buyable: true, consumable: false },
};
