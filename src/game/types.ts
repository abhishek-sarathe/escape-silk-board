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
  "hennur",
  "hoskote",
  "airport",
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

/** bus = ordinary BMTC, ac_bus = Vajra (Volvo AC), airport_bus = Vayu Vajra (KIA-x). */
/** lift = a stranger's car; it can only be offered by a city event, never hired. */
export const TRANSPORTS = ["auto", "cab", "bike_taxi", "bus", "ac_bus", "airport_bus", "lift"] as const;
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
  "choose", // answer the decision the city is asking (choice = option key)
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
  /** A real bus route number the player named ("500-D", "KIA-8"), if any. */
  line: string | null;
  /** For kind "choose": the key of the option picked. */
  choice: string | null;
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
  /** Buses only: the route number boarded, and the stops it still has to pass (current stop first). */
  line?: string;
  path?: LocationId[];
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
  /** Prompt tokens served from the provider cache (cheaper). */
  cachedTokens?: number;
}

export interface GameState {
  version: 1;
  /** Unique id for this playthrough (seeds repeat on replays), used to meter LLM cost per game. */
  id?: string;
  seed: number;
  turn: number;
  /** Minutes since 7:00 PM. Only ever increases. */
  minutes: number;
  battery: number;
  /** Notes and coins: always spendable. */
  cash: number;
  /** Money in the bank, spendable by UPI only while the phone has charge (missing on old saved games: 0). */
  upi?: number;
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
  /** A decision the city is waiting on (breakdown, shortcut offer, a friend's call...). */
  pending?: Decision | null;
  /** A friend waiting to give you a lift: be at `place` by game minute `by`. */
  meet?: { place: LocationId; by: number } | null;
  /** The Game Master agent's own short notes about this player (server-side only, never sent to the browser). */
  notes?: string[];
  /** Every stretch travelled, in order, and how: the live route map draws the evening from this. */
  journey?: JourneyLeg[];
  /** Where the city threw something at you (rain, a hold-up, a decision), pinned on the map. */
  marks?: MapMark[];
  usage: Usage;
}

export interface JourneyLeg {
  from: LocationId;
  to: LocationId;
  mode: Transport | "walk";
  /** Bus route number, when it was a bus. */
  line?: string;
  /** Game minute you reached `to`. */
  at?: number;
}

export interface MapMark {
  place: LocationId;
  minutes: number;
  /** Event or decision id, e.g. "rain", "breakdown", "decision:shortcut". */
  id: string;
  text: string;
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

export interface DecisionOption {
  key: string;
  label: string;
}

/** A question the city is asking the player. Lives in the state until answered or ignored. */
export interface Decision {
  id: string;
  prompt: string;
  options: DecisionOption[];
  /** What happens if the player does something else instead. */
  fallback: string;
}
