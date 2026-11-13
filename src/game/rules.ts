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
  bike_taxi: { label: "bike taxi", speed: 0.8, wait: 5, perKm: 9, minFare: 40, needsPhone: true, surge: [1.2, 1.6] },
  bus: { label: "airport bus", speed: 1.15, wait: 10, perKm: 6, minFare: 15, needsPhone: false, surge: [1, 1] },
};

/** Auto drivers: opening ask and the hidden lowest price, as multiples of the meter fare. */
export const AUTO_ASK: [number, number] = [1.5, 1.9];
export const AUTO_FLOOR: [number, number] = [1.05, 1.25];
export const AUTO_PATIENCE: [number, number] = [2, 3];
/** The most a driver cuts his asking price after one refused offer (12%). */
export const AUTO_MAX_DROP = 0.12;

export const WALK_MIN_PER_KM = 12;
/** Longer stretches are refused: no stretch over this can be walked in time to make the flight. */
export const MAX_WALK_KM = 4;

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

export const CHECKIN_MINUTES = 6;
/** No phone means no e-ticket: queue at the airline desk for a printout first. */
export const NO_PHONE_CHECKIN_PENALTY = 12;

export const EVENT_CHANCE = 0.22;
export const MAX_EVENTS = 3;
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
