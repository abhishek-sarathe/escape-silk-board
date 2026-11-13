"use client";

// The game's signature: a live route map of the evening. It draws the engine's real road graph (EDGES),
// then the journey the engine recorded, stretch by stretch, coloured by how you travelled; the ride
// still ahead; a marker for you; and a pin wherever the city threw something at you. At the end it is
// the ending: the whole evening on one map. Reads state only, never changes it.
import { formatClock } from "@/game/clock";
import { busLink, BUS_TYPES } from "@/game/buses";
import { EDGES, PLACES, kmToAirport, route } from "@/game/map";
import { LOCATION_IDS, type JourneyLeg, type LocationId, type MapMark, type Transport } from "@/game/types";
import type { PublicState } from "@/game/view";

/** Schematic positions, south-west (Silk Board) to north-east (the airport). For reading, not geography. */
const AT: Record<LocationId, { x: number; y: number; anchor: "start" | "middle" | "end"; dy: number }> = {
  silk_board: { x: 52, y: 160, anchor: "middle", dy: 34 },
  koramangala: { x: 168, y: 96, anchor: "middle", dy: -22 },
  mg_road: { x: 300, y: 70, anchor: "middle", dy: -22 },
  hsr: { x: 168, y: 214, anchor: "middle", dy: 34 },
  marathahalli: { x: 300, y: 226, anchor: "middle", dy: 34 },
  kr_puram: { x: 430, y: 214, anchor: "middle", dy: 34 },
  hebbal: { x: 470, y: 70, anchor: "middle", dy: -22 },
  hennur: { x: 486, y: 148, anchor: "start", dy: 5 },
  yelahanka: { x: 610, y: 70, anchor: "middle", dy: -22 },
  hoskote: { x: 610, y: 226, anchor: "middle", dy: 34 },
  airport: { x: 748, y: 148, anchor: "middle", dy: 38 },
};

type Mode = Transport | "walk";

/** How you travelled, as a line style. Real-world colours: auto yellow-green, BMTC red, Vajra blue. */
const MODE: Record<Mode, { color: string; label: string; icon: string; dash?: string }> = {
  walk: { color: "#9aa3ad", label: "On foot", icon: "🚶", dash: "2 7" },
  auto: { color: "#ffcf33", label: "Auto", icon: "🛺" },
  cab: { color: "#ece8e1", label: "Cab", icon: "🚕" },
  bike_taxi: { color: "#ff9f43", label: "Bike taxi", icon: "🛵" },
  bus: { color: "#ef4444", label: "BMTC bus", icon: "🚌" },
  ac_bus: { color: "#4aa8ff", label: "Vajra AC bus", icon: "🚌" },
  airport_bus: { color: "#4aa8ff", label: "Vayu Vajra", icon: "🚍" },
  lift: { color: "#3ecf8e", label: "A stranger's car", icon: "🚗" },
};

/** What each happening looks like as a pin. */
const PIN: Record<string, string> = {
  rain: "🌧️",
  convoy: "🚨",
  breakdown: "🚧",
  chai: "☕",
  lift: "🚗",
  green_wave: "👮",
  "decision:breakdown": "🔧",
  "decision:shortcut": "🔀",
  "decision:flood": "🌊",
  "decision:passenger": "🗣️",
  "decision:samosa": "🥟",
  "decision:friend": "📞",
};

const xy = (id: LocationId) => AT[id];
const seg = (a: LocationId, b: LocationId) => ({ x1: AT[a].x, y1: AT[a].y, x2: AT[b].x, y2: AT[b].y });
const short = (id: LocationId) => PLACES[id].short;

/** Real buses you could board right here, nearest-to-the-airport first. */
function busesFromHere(here: LocationId): { line: string; to: LocationId; fare: number; mode: Mode }[] {
  const out: { line: string; to: LocationId; fare: number; mode: Mode }[] = [];
  for (const to of LOCATION_IDS) {
    if (to === here || kmToAirport(to) >= kmToAirport(here)) continue;
    for (const type of BUS_TYPES) {
      const link = busLink(here, to, type);
      if (link) out.push({ line: link.lines[0].name, to, fare: link.fare, mode: type });
    }
  }
  // One chip per route number: its furthest useful stop.
  const best = new Map<string, (typeof out)[number]>();
  for (const b of out.sort((a, b) => kmToAirport(a.to) - kmToAirport(b.to) || a.fare - b.fare)) if (!best.has(b.line)) best.set(b.line, b);
  return [...best.values()].slice(0, 3);
}

/** Old saved games have no journey; rebuild an approximate one from the places visited. */
function journeyOf(state: PublicState): JourneyLeg[] {
  if (state.journey?.length) return state.journey;
  const legs: JourneyLeg[] = [];
  for (let i = 1; i < state.visited.length; i++) legs.push({ from: state.visited[i - 1], to: state.visited[i], mode: "walk" });
  return legs;
}

export function BengaluruMap({
  state,
  variant = "live",
  onMove,
}: {
  state: PublicState;
  /** "ending": the whole evening, no live controls (used on the end card). */
  variant?: "live" | "ending";
  /** Lets a bus chip be tapped to take that bus. */
  onMove?: (text: string) => void;
}) {
  const here = state.location;
  const playing = state.status === "playing" && variant === "live";
  const journey = journeyOf(state);
  const marks: MapMark[] = state.marks ?? [];
  const latest = journey.length - 1;

  // The stretch still ahead of the vehicle you're in (a bus follows its own line).
  const ahead = state.ride ? (state.ride.path ?? route(here, state.ride.destination, state.ride.transport) ?? []) : [];
  const rideMode: Mode | null = state.ride?.transport ?? null;
  const marker = state.status === "won" ? "🎉" : state.status === "lost" ? "😅" : MODE[rideMode ?? "walk"].icon;

  // Arrival time at each place (the last time you reached it).
  const arrived = new Map<LocationId, number>();
  journey.forEach((l) => l.at !== undefined && arrived.set(l.to, l.at));
  // Pins stack per place.
  const pinsAt = new Map<LocationId, MapMark[]>();
  marks.forEach((m) => pinsAt.set(m.place, [...(pinsAt.get(m.place) ?? []), m]));
  const modesUsed = [...new Set(journey.map((l) => l.mode))];
  const buses = playing && !state.ride && !state.pending ? busesFromHere(here) : [];
  const dist = kmToAirport(here);

  return (
    <div className="relative overflow-hidden rounded-lg border-2 border-line bg-night">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="font-display text-sm text-sodium">{variant === "ending" ? "Your evening" : "Live route"}</span>
        <span className="truncate font-mono text-[11px] text-muted">
          {state.status === "won" ? "Made it ✈️" : dist === 0 ? "At the airport" : `${dist} km to the airport`}
          {state.raining ? " · 🌧️ raining" : ""}
        </span>
      </div>

      <div className="overflow-x-auto [scrollbar-width:none]">
        <svg
          viewBox="0 0 800 290"
          role="img"
          aria-label={`Route map. ${journey.length ? `Your route: ${[journey[0].from, ...journey.map((l) => l.to)].map(short).join(", ")}.` : "You haven't moved yet."} You are at ${PLACES[here].name}.`}
          className="block h-auto w-full select-none"
        >
          {/* Every road the engine knows, faint. */}
          {EDGES.map((e) => (
            <line key={`${e.a}-${e.b}`} {...seg(e.a, e.b)} className="stroke-line" strokeWidth={6} strokeLinecap="round" />
          ))}

          {/* Where your ride is still going: a moving dotted line. */}
          {ahead.slice(1).map((to, i) => (
            <line
              key={`ahead-${ahead[i]}-${to}`}
              {...seg(ahead[i], to)}
              stroke={MODE[rideMode ?? "walk"].color}
              strokeWidth={4}
              strokeDasharray="2 10"
              strokeLinecap="round"
              opacity={0.85}
              className="scene-dash-slow"
            />
          ))}

          {/* The journey so far, in order, coloured by how you travelled. The newest stretch draws itself in. */}
          {journey.map((l, i) => (
            <line
              key={`leg-${i}-${l.from}-${l.to}`}
              {...seg(l.from, l.to)}
              stroke={MODE[l.mode].color}
              strokeWidth={7}
              strokeLinecap="round"
              strokeDasharray={MODE[l.mode].dash}
              pathLength={MODE[l.mode].dash ? undefined : 1}
              className={i === latest && !MODE[l.mode].dash && variant === "live" ? "animate-draw" : ""}
            >
              <title>{`${MODE[l.mode].label}${l.line ? ` ${l.line}` : ""}: ${short(l.from)} to ${short(l.to)}${l.at !== undefined ? `, arrived ${formatClock(l.at)}` : ""}`}</title>
            </line>
          ))}

          {/* Places */}
          {LOCATION_IDS.map((id) => {
            const p = xy(id);
            const seen = state.visited.includes(id);
            const isAirport = id === "airport";
            const t = arrived.get(id);
            return (
              <g key={id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isAirport ? 13 : 9}
                  className={isAirport ? "fill-go stroke-night" : seen ? "fill-paper stroke-night" : "fill-panel stroke-muted"}
                  strokeWidth={3}
                />
                {isAirport && (
                  <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize={13}>
                    ✈
                  </text>
                )}
                <text
                  x={p.x}
                  y={p.y + p.dy}
                  dx={p.anchor === "start" ? 18 : 0}
                  textAnchor={p.anchor}
                  className={`font-mono uppercase ${id === here ? "fill-paper" : seen ? "fill-paper/80" : "fill-muted"}`}
                  fontSize={22}
                  fontWeight={id === here ? 700 : 500}
                >
                  {short(id)}
                </text>
                {t !== undefined && id !== state.visited[0] && (
                  <text
                    x={p.x}
                    y={p.y + p.dy + (p.dy < 0 ? -22 : 22)}
                    dx={p.anchor === "start" ? 18 : 0}
                    textAnchor={p.anchor}
                    className="fill-sodium font-mono"
                    fontSize={18}
                  >
                    {formatClock(t)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Pins: what happened where. */}
          {[...pinsAt].map(([place, list]) =>
            list.map((m, i) => (
              <g key={`${m.id}-${m.minutes}`} transform={`translate(${xy(place).x + 16 + i * 24}, ${xy(place).y - 24})`} className="animate-rise">
                <circle r={12} className="fill-panel stroke-sodium" strokeWidth={1.5} />
                <text textAnchor="middle" y={5} fontSize={13}>
                  {PIN[m.id] ?? "❗"}
                </text>
                <title>{`${formatClock(m.minutes)} at ${short(place)}: ${m.text}`}</title>
              </g>
            )),
          )}

          {/* You */}
          <g style={{ transform: `translate(${xy(here).x}px, ${xy(here).y}px)` }} className="transition-transform duration-700 ease-out">
            {playing && <circle r={22} className="fill-sodium/25 animate-pulse-soft" />}
            <circle r={16} className="fill-night stroke-sodium" strokeWidth={2.5} />
            <text textAnchor="middle" y={6} fontSize={17} className={playing && state.ride ? "scene-bob" : ""}>
              {marker}
            </text>
          </g>
        </svg>
      </div>

      {/* Legend: only the ways you've actually travelled tonight. */}
      {modesUsed.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 font-mono text-[10px] uppercase text-muted">
          {modesUsed.map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1 w-4 rounded-full" style={{ background: MODE[m].color }} />
              {MODE[m].label}
            </span>
          ))}
          {marks.length > 0 && <span>· {marks.length} thing{marks.length > 1 ? "s" : ""} happened (tap a pin)</span>}
        </div>
      )}

      {/* Live: your ride, or the real buses you could board right here (tap one to take it). */}
      {playing && (state.ride || buses.length > 0) && (
        <div className="hidden flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 text-[11px] sm:flex">
          {state.ride ? (
            <span className="font-mono text-paper">
              {MODE[state.ride.transport].icon} {state.ride.line ? `${state.ride.line} ` : `${MODE[state.ride.transport].label} `}to {short(state.ride.destination)}
              {ahead.length > 1 && <span className="text-muted"> · {ahead.length - 1} stop{ahead.length > 2 ? "s" : ""} to go</span>}
            </span>
          ) : (
            <>
              <span className="font-mono uppercase text-muted">Buses from here:</span>
              {buses.map((b) => (
                <button
                  key={`${b.line}-${b.to}`}
                  type="button"
                  disabled={!onMove}
                  onClick={() => onMove?.(`Take the ${b.line} to ${short(b.to)}`)}
                  className="rounded-md border px-2 py-0.5 font-mono font-semibold transition hover:bg-paper hover:text-night disabled:cursor-default"
                  style={{ borderColor: MODE[b.mode].color, color: MODE[b.mode].color }}
                >
                  {b.line} → {short(b.to)} ₹{b.fare}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
