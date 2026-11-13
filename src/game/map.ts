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
    aliases: ["kr puram", "tin factory", "hennur"],
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

export interface Edge {
  a: LocationId;
  b: LocationId;
  km: number;
  /** Minutes by road at 7 PM, before transport speed / rain. */
  minutes: number;
  /** Airport buses run on this stretch. */
  bus: boolean;
}

// Two ways north: the Outer Ring Road (longer, has airport buses) and through the
// centre (shorter, no airport bus until MG Road). Both meet at Hebbal.
export const EDGES: Edge[] = [
  { a: "silk_board", b: "hsr", km: 3, minutes: 12, bus: true },
  { a: "silk_board", b: "koramangala", km: 4, minutes: 15, bus: false },
  { a: "hsr", b: "koramangala", km: 3, minutes: 10, bus: false },
  { a: "hsr", b: "marathahalli", km: 9, minutes: 22, bus: true },
  { a: "koramangala", b: "mg_road", km: 7, minutes: 20, bus: false },
  { a: "marathahalli", b: "kr_puram", km: 8, minutes: 16, bus: true },
  { a: "kr_puram", b: "hebbal", km: 11, minutes: 18, bus: true },
  { a: "mg_road", b: "hebbal", km: 9, minutes: 20, bus: true },
  { a: "hebbal", b: "yelahanka", km: 10, minutes: 12, bus: true },
  { a: "yelahanka", b: "airport", km: 18, minutes: 15, bus: true },
];

export type Mode = Transport | "walk";

export function edgeBetween(a: LocationId, b: LocationId): Edge | undefined {
  return EDGES.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

export function neighbors(id: LocationId, mode: Mode = "walk"): LocationId[] {
  return EDGES.filter((e) => (e.a === id || e.b === id) && (mode !== "bus" || e.bus)).map((e) =>
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
  return km;
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
