// Real BMTC buses between the game's places, derived from the unofficial BMTC GTFS feed
// (scripts/build-bus-data.py; data ODbL-1.0, see busData.LICENSE.md). Server-side only: the
// browser never loads this file, it only sees the ride the engine started.
import data from "./busData.json";
import { kmToAirport } from "./map";
import type { LocationId, Transport } from "./types";

export const BUS_TYPES = ["bus", "ac_bus", "airport_bus"] as const;
export type BusType = (typeof BUS_TYPES)[number];

export interface BusLine {
  name: string;
  /** The game places this line passes, from boarding stop to destination. */
  path: LocationId[];
}

export interface BusLink {
  fare: number;
  /** Average minutes until the next bus, from how often these lines run. */
  wait: number;
  lines: BusLine[];
}

type Links = Record<string, Partial<Record<BusType, BusLink>>>;
const LINKS = data.links as unknown as Links;
const SPEED = data.speed as Record<BusType, number>;

export const BUS_SOURCE = data.source;

export const isBus = (t: Transport | null | undefined): t is BusType => (BUS_TYPES as readonly string[]).includes(t ?? "");

/** Road-time multiplier for this kind of bus (scaled from how fast it runs in the real timetable). */
export const busSpeed = (t: BusType): number => SPEED[t] ?? 1.15;

export function busLink(from: LocationId, to: LocationId, type: BusType): BusLink | null {
  return LINKS[`${from}>${to}`]?.[type] ?? null;
}

/** "kia8", "KIA 8", "v500d", "500d" -> "KIA-8", "V-500D", "500-D". */
export function normaliseLine(raw: string): string {
  const t = raw.toUpperCase().replace(/\s+/g, "");
  const m = t.match(/^(KIA|V|[A-Z]{1,3})?-?(\d{1,3})-?([A-Z]{0,3})$/);
  if (!m) return t;
  const [, pre, num, suf] = m;
  return `${pre ? `${pre}-` : ""}${num}${suf ? (pre ? suf : `-${suf}`) : ""}`;
}

export interface LineStop {
  type: BusType;
  to: LocationId;
  link: BusLink;
  line: BusLine;
}

/** Every place a named line can take you from here, nearest the airport first. */
export function lineFrom(from: LocationId, name: string): LineStop[] {
  const want = normaliseLine(name);
  const out: LineStop[] = [];
  for (const [key, byType] of Object.entries(LINKS)) {
    const [a, b] = key.split(">") as [LocationId, LocationId];
    if (a !== from) continue;
    for (const [type, link] of Object.entries(byType) as [BusType, BusLink][]) {
      const line = link.lines.find((l) => normaliseLine(l.name) === want);
      if (line) out.push({ type, to: b, link, line });
    }
  }
  return out.sort((x, y) => kmToAirport(x.to) - kmToAirport(y.to));
}

/** The most useful buses from here, for a refusal that teaches: one per kind, going furthest towards the airport. */
export function busOptions(from: LocationId, limit = 3): LineStop[] {
  const best = new Map<BusType, LineStop>();
  for (const [key, byType] of Object.entries(LINKS)) {
    const [a, b] = key.split(">") as [LocationId, LocationId];
    if (a !== from || kmToAirport(b) >= kmToAirport(from)) continue;
    for (const [type, link] of Object.entries(byType) as [BusType, BusLink][]) {
      const cur = best.get(type);
      if (!cur || kmToAirport(b) < kmToAirport(cur.to)) best.set(type, { type, to: b, link, line: link.lines[0] });
    }
  }
  return [...best.values()].sort((x, y) => kmToAirport(x.to) - kmToAirport(y.to)).slice(0, limit);
}
