import { AIRPORT_TOLL, TOLL_PAYERS, TRAFFIC } from "./rules";
import type { LocationId, Transport } from "./types";
import { LOCATION_IDS } from "./types";

export interface Place {
  id: LocationId;
  name: string;
  short: string;
  /** Somewhere to buy chai or beg a charging point. */
  shops: boolean;
  priceMultiplier: number;
  aliases: string[];
  blurb: string;
}

export const PLACES: Record<LocationId, Place> = {
  silk_board: {
    id: "silk_board",
    name: "Silk Board Junction",
    short: "Silk Board",
    shops: true,
    priceMultiplier: 1,
    aliases: ["silk board", "central silk board", "btm"],
    blurb: "Bengaluru's most famous junction. Nothing has moved since lunch.",
  },
  hsr: {
    id: "hsr",
    name: "HSR Layout (Agara)",
    short: "HSR",
    shops: true,
    priceMultiplier: 1,
    aliases: ["hsr", "agara", "bellandur", "outer ring road", "orr"],
    blurb: "Start of the Outer Ring Road. Airport buses stop here.",
  },
  koramangala: {
    id: "koramangala",
    name: "Koramangala",
    short: "Koramangala",
    shops: true,
    priceMultiplier: 1,
    aliases: ["koramangala", "sony signal", "forum", "madiwala", "st john"],
    blurb: "Startups, cafés, and a signal that lasts a season.",
  },
  marathahalli: {
    id: "marathahalli",
    name: "Marathahalli Bridge",
    short: "Marathahalli",
    shops: true,
    priceMultiplier: 1,
    aliases: ["marathahalli", "whitefield", "sarjapur", "ecospace", "kadubeesanahalli"],
    blurb: "Every tech park in the city emptying onto one bridge.",
  },
  mg_road: {
    id: "mg_road",
    name: "MG Road",
    short: "MG Road",
    shops: true,
    priceMultiplier: 1,
    aliases: ["mg road", "indiranagar", "domlur", "richmond", "cubbon", "majestic", "trinity", "city centre"],
    blurb: "The old city centre. Wide roads, many signals.",
  },
  kr_puram: {
    id: "kr_puram",
    name: "KR Puram (Tin Factory)",
    short: "KR Puram",
    shops: true,
    priceMultiplier: 1,
    aliases: ["kr puram", "tin factory", "kr puram bridge"],
    blurb: "Where buses go to reflect on their choices.",
  },
  hebbal: {
    id: "hebbal",
    name: "Hebbal Flyover",
    short: "Hebbal",
    shops: false,
    priceMultiplier: 1,
    aliases: ["hebbal", "hebbal flyover", "mekhri circle", "esteem mall"],
    blurb: "The flyover. Every road to the airport meets here.",
  },
  yelahanka: {
    id: "yelahanka",
    name: "Yelahanka, Airport Road",
    short: "Yelahanka",
    shops: true,
    priceMultiplier: 1,
    aliases: ["yelahanka", "airport road", "bellary road", "nh44", "trumpet"],
    blurb: "Six lanes and, suddenly, speed.",
  },
  hennur: {
    id: "hennur",
    name: "Hennur Cross (Outer Ring Road)",
    short: "Hennur",
    shops: true,
    priceMultiplier: 1,
    aliases: ["hennur", "kalyan nagar", "hrbr", "banaswadi", "nagawara", "bagalur", "kothanur", "hennur bagalur road"],
    blurb: "Where the Hennur-Bagalur road leaves the Ring Road for the airport.",
  },
  hoskote: {
    id: "hoskote",
    name: "Hoskote (Old Madras Road)",
    short: "Hoskote",
    shops: true,
    priceMultiplier: 1,
    aliases: ["hoskote", "old madras road", "budigere", "nh75", "nh 75"],
    blurb: "Out past the city on Old Madras Road. The back way to the airport, with no toll.",
  },
  airport: {
    id: "airport",
    name: "Kempegowda Airport, Departures",
    short: "Airport",
    shops: true,
    priceMultiplier: 3,
    aliases: ["airport", "kial", "kempegowda", "terminal", "departures", "bial"],
    blurb: "The departures curb. Check-in is inside.",
  },
};

export type Zone = keyof typeof TRAFFIC;

interface Road {
  a: LocationId;
  b: LocationId;
  /** Real road distance (OpenStreetMap routing between the two places). */
  km: number;
  /** Real empty-road driving minutes (same source). */
  free: number;
  /** How badly 7 PM traffic hits this stretch; see TRAFFIC in rules.ts. */
  zone: Zone;
  /** Toll on this stretch for TOLL_PAYERS, in rupees. */
  toll?: number;
}

export interface Edge extends Road {
  /** Minutes by road at 7 PM, before transport speed / rain. */
  readonly minutes: number;
}

// Three ways north, all real roads:
//  - the Outer Ring Road: HSR, Marathahalli, KR Puram, then Hennur and Hebbal (KIA-8 runs it);
//  - through the centre: Koramangala, MG Road, then Hebbal or Hennur (KIA-7A comes this way);
//  - out east: KR Puram, Old Madras Road to Hoskote, then SH-104A to the airport, toll-free.
// From Hebbal the NH-44 runs via Yelahanka (tolled); from Hennur the Hennur-Bagalur road goes straight up.
// km and free minutes are OpenStreetMap routing (OSRM) between the places. Which buses run where,
// and for how much, is real BMTC data: see buses.ts.
const ROADS: Road[] = [
  { a: "silk_board", b: "hsr", km: 3.6, free: 6, zone: "city" },
  { a: "silk_board", b: "koramangala", km: 4.1, free: 7, zone: "city" },
  { a: "hsr", b: "koramangala", km: 3.7, free: 4, zone: "city" },
  { a: "hsr", b: "marathahalli", km: 7.8, free: 11, zone: "city" },
  { a: "koramangala", b: "mg_road", km: 6.7, free: 9, zone: "city" },
  { a: "marathahalli", b: "kr_puram", km: 9.4, free: 13, zone: "city" },
  { a: "kr_puram", b: "hennur", km: 6.6, free: 10, zone: "city" },
  { a: "hennur", b: "hebbal", km: 7.0, free: 11, zone: "city" },
  { a: "mg_road", b: "hebbal", km: 12.8, free: 16, zone: "city" },
  { a: "mg_road", b: "hennur", km: 7.9, free: 10, zone: "city" },
  { a: "hebbal", b: "yelahanka", km: 9.6, free: 12, zone: "highway" },
  { a: "yelahanka", b: "airport", km: 20.3, free: 21, zone: "highway", toll: AIRPORT_TOLL },
  { a: "hennur", b: "airport", km: 26.0, free: 26, zone: "arterial" },
  { a: "kr_puram", b: "hoskote", km: 18.5, free: 16, zone: "arterial" },
  { a: "hoskote", b: "airport", km: 33.2, free: 32, zone: "highway" },
];

export const EDGES: Edge[] = ROADS.map((r) => ({
  ...r,
  get minutes() {
    return Math.max(1, Math.round(r.free * TRAFFIC[r.zone]));
  },
}));

/** Toll this transport pays along a path (cabs and autos on the NH-44 stretch). */
export function tollOn(path: LocationId[], transport: Mode): number {
  if (!(TOLL_PAYERS as readonly string[]).includes(transport)) return 0;
  let toll = 0;
  for (let i = 1; i < path.length; i++) toll += edgeBetween(path[i - 1], path[i])?.toll ?? 0;
  return toll;
}

export type Mode = Transport | "walk";

export function edgeBetween(a: LocationId, b: LocationId): Edge | undefined {
  return EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

export function neighbors(id: LocationId, mode: Mode = "walk"): LocationId[] {
  void mode; // every stretch has a road; which buses run it is decided per line in buses.ts
  return EDGES.filter((e) => e.a === id || e.b === id).map((e) =>
    e.a === id ? e.b : e.a,
  );
}

/** Cheapest path (walking: shortest km; vehicles: fewest minutes). Null if unreachable. */
export function route(from: LocationId, to: LocationId, mode: Mode): LocationId[] | null {
  if (from === to) return [from];
  const dist = new Map<LocationId, number>(LOCATION_IDS.map((id) => [id, Infinity]));
  const prev = new Map<LocationId, LocationId>();
  const open = new Set<LocationId>(LOCATION_IDS);
  dist.set(from, 0);

  while (open.size) {
    let current: LocationId | null = null;
    for (const id of open) if (current === null || dist.get(id)! < dist.get(current)!) current = id;
    if (current === null || dist.get(current) === Infinity) break;
    open.delete(current);
    if (current === to) break;
    for (const next of neighbors(current, mode)) {
      const edge = edgeBetween(current, next)!;
      const cost = dist.get(current)! + (mode === "walk" ? edge.km : edge.minutes);
      if (cost < dist.get(next)!) {
        dist.set(next, cost);
        prev.set(next, current);
      }
    }
  }

  if (!prev.has(to)) return null;
  const path: LocationId[] = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

export function pathKm(path: LocationId[]): number {
  let km = 0;
  for (let i = 1; i < path.length; i++) km += edgeBetween(path[i - 1], path[i])!.km;
  return Math.round(km * 10) / 10; // no 29.900000000000002 km in the story
}

export function kmToAirport(id: LocationId): number {
  return pathKm(route(id, "airport", "walk") ?? [id]);
}

/** Map free text ("Indiranagar", "the airport") to a known place. */
export function findPlace(text: string): LocationId | null {
  const t = text.toLowerCase().replace(/_/g, " ");
  const has = (phrase: string) => new RegExp(`\\b${phrase}\\b`).test(t);
  for (const id of LOCATION_IDS) {
    if (has(id.replace(/_/g, " ")) || PLACES[id].aliases.some(has)) return id;
  }
  return null;
}
