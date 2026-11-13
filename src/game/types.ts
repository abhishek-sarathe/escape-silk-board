// Core game types. Everything in GameState is owned by code; the LLM never writes to it.

export const LOCATION_IDS = [
  "silk_board",
  "hsr",
  "koramangala",
  "marathahalli",
  "mg_road",
  "kr_puram",
  "hebbal",
  "yelahanka",
  "airport",
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

export const TRANSPORTS = ["auto", "cab", "bike_taxi", "bus"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const ITEM_IDS = ["samosa", "chai", "coffee", "water", "umbrella"] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const ACTION_KINDS = [
  "hire", // find / haggle / book a vehicle
  "walk", // move one stretch on foot
  "continue", // keep riding
  "leave_ride", // get out of the current vehicle
  "charge", // charge the phone
  "buy", // buy something from a shop
  "call", // phone someone
  "use_item", // eat / drink / give / use something from the bag
  "check_in", // run to the check-in counter (airport only)
  "wait", // do nothing for a while
  "other", // possible in the world, but changes nothing
  "impossible", // cheating, superpowers, talking to the AI
  "give_up", // abandon the trip
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type CallTarget = "friend" | "family" | "airline" | "other";

/** What the player is trying to do, as parsed by the referee (LLM or fallback parser). */
export interface Action {
  kind: ActionKind;
  transport: Transport | null;
  destination: LocationId | null;
  /** Cash the player offers in a haggle. */
  offer: number | null;
  /** Player asked for "meter" fare. */
  offerMeter: boolean;
  /** Player agrees to the driver's current asking price. */
  acceptAsk: boolean;
  /** Player only wants to know the price: nothing is booked or paid. */
  priceCheck: boolean;
  items: ItemId[];
  minutes: number | null;
  who: CallTarget | null;
  /** Short paraphrase of the intent, used for flavour only. */
  note: string;
}

export interface Ride {
  transport: Transport;
  destination: LocationId;
}

/** An auto driver's standing offer. `floor` is secret: it is stripped before state reaches the browser. */
export interface Quote {
  destination: LocationId;
  ask: number;
  floor: number;
  patience: number;
}

export type GameStatus = "playing" | "won" | "lost";

export interface TurnRecord {
  input: string;
  narration: string;
}

export interface Usage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface GameState {
  version: 1;
  seed: number;
  turn: number;
  /** Minutes since 7:00 PM. Only ever increases. */
  minutes: number;
  battery: number;
  cash: number;
  location: LocationId;
  inventory: ItemId[];
  ride: Ride | null;
  quote: Quote | null;
  raining: boolean;
  /** Extra minutes added to the next road stretch (convoy, breakdown...). */
  pendingDelay: number;
  pendingDelayReason: string | null;
  /** +/- minutes from a friend's "shortcut", applied to the next road stretch. */
  shortcutBonus: number;
  flags: string[];
  visited: LocationId[];
  status: GameStatus;
  endReason: string | null;
  history: TurnRecord[];
  usage: Usage;
}

export interface CityEvent {
  id: string;
  text: string;
}

export interface Outcome {
  /** What actually happened, in plain sentences. Authoritative for the narrator. */
  facts: string[];
  /** What the player tried that the rules refused, and why. */
  refused: string[];
  event: CityEvent | null;
  delta: {
    minutes: number;
    cash: number;
    battery: number;
    from: LocationId;
    to: LocationId;
    itemsGained: ItemId[];
    itemsLost: ItemId[];
  };
}

export interface TurnResult {
  state: GameState;
  outcome: Outcome;
}
