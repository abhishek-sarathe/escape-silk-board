"use client";

// The game's signature: a live route map of the evening, drawn like a phone maps app (light land,
// white streets, yellow highways, coloured route lines with a white casing, a blue "you are here" dot,
// a red pin on the airport). It draws the engine's real road graph (EDGES) with each road's 7 PM time and
// toll, then the journey the engine recorded, the ride still ahead, and a pin wherever the city threw
// something at you. At the end it is the ending: the whole evening on one map. Reads state only.
import { formatClock } from "@/game/clock";
import { busLink, BUS_TYPES } from "@/game/buses";
import { EDGES, PLACES, edgeBetween, kmToAirport, neighbors, route, tollOn } from "@/game/map";
import { LOCATION_IDS, type JourneyLeg, type LocationId, type MapMark, type Transport } from "@/game/types";
import type { PublicState } from "@/game/view";

/** Schematic positions, south-west (Silk Board) to north-east (the airport), plus where each label sits. */
const AT: Record<LocationId, { x: number; y: number; lx: number; ly: number; anchor: "start" | "middle" | "end" }> = {
  silk_board: { x: 60, y: 160, lx: 26, ly: 196, anchor: "start" },
  koramangala: { x: 172, y: 100, lx: 172, ly: 76, anchor: "middle" },
  mg_road: { x: 300, y: 72, lx: 300, ly: 48, anchor: "middle" },
  hsr: { x: 172, y: 214, lx: 172, ly: 248, anchor: "middle" },
  marathahalli: { x: 300, y: 226, lx: 300, ly: 260, anchor: "middle" },
  kr_puram: { x: 430, y: 214, lx: 430, ly: 248, anchor: "middle" },
  hebbal: { x: 470, y: 72, lx: 470, ly: 48, anchor: "middle" },
  hennur: { x: 486, y: 148, lx: 506, ly: 154, anchor: "start" },
  yelahanka: { x: 616, y: 72, lx: 616, ly: 48, anchor: "middle" },
  hoskote: { x: 616, y: 226, lx: 616, ly: 260, anchor: "middle" },
  airport: { x: 748, y: 148, lx: 748, ly: 196, anchor: "middle" },
};

type Mode = Transport | "walk";

/** How you travelled, as a route line. Real-world colours: auto yellow-green, BMTC red, Vajra blue. */
const MODE: Record<Mode, { color: string; label: string; icon: string; dotted?: boolean }> = {
  walk: { color: "#1a73e8", label: "Walk", icon: "🚶", dotted: true },
  auto: { color: "#2e9e4f", label: "Auto", icon: "🛺" },
  cab: { color: "#1a73e8", label: "Cab", icon: "🚕" },
  bike_taxi: { color: "#f29900", label: "Bike taxi", icon: "🛵" },
  bus: { color: "#d93025", label: "BMTC bus", icon: "🚌" },
  ac_bus: { color: "#1967d2", label: "Vajra AC", icon: "🚌" },
  airport_bus: { color: "#1967d2", label: "Vayu Vajra", icon: "🚍" },
  lift: { color: "#9334e6", label: "A stranger's car", icon: "🚗" },
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

// Maps-app palette (light, fixed: it is a printed map inside the dark game).
const LAND = "#f1f3f4";
const STREET = "#ffffff";
const STREET_CASE = "#dadce0";
const HIGHWAY = "#fde293";
const HIGHWAY_CASE = "#f2c94c";
const WATER = "#aadaff";
const PARK = "#c8e6c9";
const INK = "#3c4043";
const INK_SOFT = "#70757a";

const xy = (id: LocationId) => AT[id];
const seg = (a: LocationId, b: LocationId) => ({ x1: AT[a].x, y1: AT[a].y, x2: AT[b].x, y2: AT[b].y });
const short = (id: LocationId) => PLACES[id].short;
const sameRoad = (a: LocationId, b: LocationId, c: LocationId, d: LocationId) => (a === c && b === d) || (a === d && b === c);

/** Real buses you could board right here, nearest-to-the-airport first, one per route number. */
function busesFromHere(here: LocationId): { line: string; to: LocationId; fare: number; mode: Mode }[] {
  const out: { line: string; to: LocationId; fare: number; mode: Mode }[] = [];
  for (const to of LOCATION_IDS) {
    if (to === here || kmToAirport(to) >= kmToAirport(here)) continue;
    for (const type of BUS_TYPES) {
      const link = busLink(here, to, type);
      if (link) out.push({ line: link.lines[0].name, to, fare: link.fare, mode: type });
    }
  }
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

/** 7 PM road minutes along a path (before the vehicle's own speed, rain and hold-ups). */
const pathMinutes = (path: LocationId[]) => path.slice(1).reduce((sum, to, i) => sum + (edgeBetween(path[i], to)?.minutes ?? 0), 0);

/** A rounded label on a road, like a maps app's time bubble. */
function Pill({ x, y, text, tone }: { x: number; y: number; text: string; tone: "plain" | "route" | "toll" }) {
  const w = text.length * 10.5 + 18;
  const fill = tone === "route" ? "#1a73e8" : tone === "toll" ? "#fef7e0" : "#ffffff";
  const ink = tone === "route" ? "#ffffff" : tone === "toll" ? "#b06000" : INK;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-w / 2} y={-14} width={w} height={28} rx={14} fill={fill} stroke={tone === "toll" ? "#f2c94c" : "#dadce0"} strokeWidth={1.5} />
      <text textAnchor="middle" y={6} fontSize={17} fontWeight={600} fill={ink}>
        {text}
      </text>
    </g>
  );
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

  // The ETA card: your ride's arrival, or the quickest road to the airport from here.
  const toAirport = route(here, "airport", "cab") ?? [];
  const eta = state.ride
    ? { label: `${state.ride.line ?? MODE[state.ride.transport].label} to ${short(state.ride.destination)}`, minutes: pathMinutes(ahead), toll: tollOn(ahead, state.ride.transport) }
    : here !== "airport"
      ? { label: "Airport by road", minutes: pathMinutes(toAirport), toll: tollOn(toAirport, "cab") }
      : null;

  // Arrival time at each place (the last time you reached it); pins stacked per place.
  const arrived = new Map<LocationId, number>();
  journey.forEach((l) => l.at !== undefined && arrived.set(l.to, l.at));
  const pinsAt = new Map<LocationId, MapMark[]>();
  marks.forEach((m) => pinsAt.set(m.place, [...(pinsAt.get(m.place) ?? []), m]));
  const modesUsed = [...new Set(journey.map((l) => l.mode))];
  const buses = playing && !state.ride && !state.pending ? busesFromHere(here) : [];

  // Time pills: the roads ahead of your ride, or the roads you could take from where you stand.
  const timed = playing
    ? state.ride
      ? ahead.slice(1).map((to, i) => [ahead[i], to] as const)
      : neighbors(here).map((to) => [here, to] as const)
    : [];
  const onRoute = (a: LocationId, b: LocationId) => ahead.slice(1).some((to, i) => sameRoad(a, b, ahead[i], to));

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel">
      <div className="relative">
        <svg
          viewBox="0 0 800 290"
          role="img"
          aria-label={`Route map. ${journey.length ? `Your route: ${[journey[0].from, ...journey.map((l) => l.to)].map(short).join(", ")}.` : "You haven't moved yet."} You are at ${PLACES[here].name}.${eta ? ` ${eta.label}: about ${eta.minutes} minutes${eta.toll ? `, ₹${eta.toll} toll` : ""}.` : ""}`}
          className="block h-auto w-full select-none font-sans"
        >
          {/* Land, water and parks, for orientation (decoration, not game data). */}
          <rect width="800" height="290" fill={LAND} />
          <ellipse cx="236" cy="252" rx="34" ry="14" fill={WATER} /> {/* Bellandur Lake */}
          <ellipse cx="236" cy="190" rx="14" ry="9" fill={WATER} /> {/* Agara Lake */}
          <ellipse cx="430" cy="98" rx="22" ry="11" fill={WATER} /> {/* Hebbal Lake */}
          <rect x="262" y="96" width="44" height="26" rx="10" fill={PARK} /> {/* Cubbon Park */}
          <rect x="680" y="104" width="100" height="88" rx="18" fill="#e8eaed" /> {/* the airfield */}

          {/* Every road the engine knows: casing, then fill. Highways yellow, like a maps app. */}
          {EDGES.map((e) => (
            <line key={`c-${e.a}-${e.b}`} {...seg(e.a, e.b)} stroke={e.zone === "highway" ? HIGHWAY_CASE : STREET_CASE} strokeWidth={13} strokeLinecap="round" />
          ))}
          {EDGES.map((e) => (
            <line key={`f-${e.a}-${e.b}`} {...seg(e.a, e.b)} stroke={e.zone === "highway" ? HIGHWAY : STREET} strokeWidth={9} strokeLinecap="round" />
          ))}

          {/* Where your ride is still going: the route line, lighter, with moving dots. */}
          {ahead.slice(1).map((to, i) => (
            <g key={`ahead-${ahead[i]}-${to}`}>
              <line {...seg(ahead[i], to)} stroke={MODE[rideMode ?? "walk"].color} strokeOpacity={0.35} strokeWidth={9} strokeLinecap="round" />
              <line {...seg(ahead[i], to)} stroke="#ffffff" strokeWidth={3} strokeDasharray="1 12" strokeLinecap="round" className="scene-dash-slow" />
            </g>
          ))}

          {/* The journey so far, coloured by how you travelled, with a white casing. Newest stretch draws in. */}
          {journey.map((l, i) => {
            const m = MODE[l.mode];
            const fresh = i === latest && variant === "live" && !m.dotted;
            return (
              <g key={`leg-${i}-${l.from}-${l.to}`}>
                <title>{`${m.label}${l.line ? ` ${l.line}` : ""}: ${short(l.from)} to ${short(l.to)}${l.at !== undefined ? `, arrived ${formatClock(l.at)}` : ""}`}</title>
                {m.dotted ? (
                  <line {...seg(l.from, l.to)} stroke={m.color} strokeWidth={7} strokeDasharray="0.1 13" strokeLinecap="round" />
                ) : (
                  <>
                    <line {...seg(l.from, l.to)} stroke="#ffffff" strokeWidth={13} strokeLinecap="round" />
                    <line {...seg(l.from, l.to)} stroke={m.color} strokeWidth={8} strokeLinecap="round" pathLength={1} className={fresh ? "animate-draw" : ""} />
                  </>
                )}
              </g>
            );
          })}

          {/* Toll badge on every tolled road; time pills on the roads that matter right now. */}
          {EDGES.filter((e) => e.toll).map((e) => (
            <Pill key={`toll-${e.a}-${e.b}`} x={(xy(e.a).x + xy(e.b).x) / 2} y={(xy(e.a).y + xy(e.b).y) / 2 - 22} text={`₹${e.toll} toll`} tone="toll" />
          ))}
          {timed.map(([a, b]) => {
            const e = edgeBetween(a, b)!;
            return <Pill key={`t-${a}-${b}`} x={(xy(a).x + xy(b).x) / 2} y={(xy(a).y + xy(b).y) / 2 + (e.toll ? 14 : 0)} text={`${e.minutes} min`} tone={onRoute(a, b) ? "route" : "plain"} />;
          })}

          {/* Places, with a white halo behind each label so it reads over roads. */}
          {LOCATION_IDS.map((id) => {
            const p = xy(id);
            if (id === "airport") return null;
            const seen = state.visited.includes(id);
            const t = arrived.get(id);
            const labelProps = { x: p.lx, textAnchor: p.anchor, stroke: "#ffffff", strokeWidth: 5, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
            return (
              <g key={id}>
                <circle cx={p.x} cy={p.y} r={7} fill="#ffffff" stroke={seen ? INK : "#9aa0a6"} strokeWidth={3} />
                <text {...labelProps} y={p.ly} fontSize={21} fontWeight={id === here ? 700 : 500} fill={seen || id === here ? INK : INK_SOFT}>
                  {short(id)}
                </text>
                {t !== undefined && id !== state.visited[0] && (
                  <text {...labelProps} y={p.ly + (p.ly < p.y ? -20 : 20)} fontSize={16} fontWeight={600} fill="#1a73e8">
                    {formatClock(t)}
                  </text>
                )}
              </g>
            );
          })}

          {/* The airport: a red map pin. */}
          <g transform={`translate(${xy("airport").x}, ${xy("airport").y})`}>
            <path d="M0 0 C -14 -18 -16 -24 -16 -32 A 16 16 0 1 1 16 -32 C 16 -24 14 -18 0 0 Z" fill="#ea4335" stroke="#b31412" strokeWidth={1.5} />
            <text y={-26} textAnchor="middle" fontSize={15}>
              ✈
            </text>
            <text y={48} textAnchor="middle" fontSize={21} fontWeight={700} fill={INK} stroke="#ffffff" strokeWidth={5} paintOrder="stroke">
              KIA T2
            </text>
          </g>

          {/* Pins: what happened where. */}
          {[...pinsAt].map(([place, list]) =>
            list.map((m, i) => (
              <g key={`${m.id}-${m.minutes}`} transform={`translate(${xy(place).x + 20 + i * 28}, ${xy(place).y - 26})`} className="animate-rise">
                <circle r={14} fill="#ffffff" stroke="#dadce0" strokeWidth={1.5} />
                <text textAnchor="middle" y={5} fontSize={15}>
                  {PIN[m.id] ?? "❗"}
                </text>
                <title>{`${formatClock(m.minutes)} at ${short(place)}: ${m.text}`}</title>
              </g>
            )),
          )}

          {/* You: the blue dot, with your vehicle beside it while riding. */}
          <g style={{ transform: `translate(${xy(here).x}px, ${xy(here).y}px)` }} className="transition-transform duration-700 ease-out">
            {playing && <circle r={24} fill="#4285f4" fillOpacity={0.18} className="animate-pulse-soft" />}
            <circle r={11} fill={state.status === "lost" ? "#ea4335" : "#4285f4"} stroke="#ffffff" strokeWidth={4} />
            {state.ride && (
              <text x={16} y={-12} fontSize={20} className={playing ? "scene-bob" : ""}>
                {MODE[state.ride.transport].icon}
              </text>
            )}
            {state.status === "won" && (
              <text x={14} y={-12} fontSize={20}>
                🎉
              </text>
            )}
          </g>
        </svg>

      </div>

      {/* ETA strip under the map (an overlay would cover Silk Board and the centre on small screens). */}
      {eta && variant === "live" && state.status === "playing" && (
        <div className="flex items-baseline gap-1.5 border-t border-line bg-white px-3 py-1.5 text-[11px] text-[#3c4043]">
          <span className="truncate font-medium text-[#70757a]">{eta.label}</span>
          <span className="font-bold text-[#1e8e3e]">{eta.minutes} min</span>
          <span className="text-[#70757a]">· ETA {formatClock(state.minutes + eta.minutes)}</span>
          <span className={`ml-auto shrink-0 font-semibold ${eta.toll ? "text-[#b06000]" : "text-[#70757a]"}`}>{eta.toll ? `₹${eta.toll} toll` : "No toll"}</span>
        </div>
      )}

      {/* Legend: only the ways you've actually travelled tonight. */}
      {modesUsed.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-1.5 font-mono text-[10px] uppercase text-muted">
          {modesUsed.map((m) => (
            <span key={m} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: MODE[m].color }} />
              {MODE[m].label}
            </span>
          ))}
          {marks.length > 0 && <span>· {marks.length} thing{marks.length > 1 ? "s" : ""} happened (tap a pin)</span>}
        </div>
      )}

      {/* Live: the real buses you could board right here (tap one to take it). */}
      {buses.length > 0 && (
        <div className="hidden flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 text-[11px] sm:flex">
          <span className="font-mono uppercase text-muted">Buses from here:</span>
          {buses.map((b) => (
            <button
              key={`${b.line}-${b.to}`}
              type="button"
              disabled={!onMove}
              onClick={() => onMove?.(`Take the ${b.line} to ${short(b.to)}`)}
              className="rounded-md px-2 py-0.5 font-mono font-semibold text-white transition hover:brightness-110 disabled:cursor-default"
              style={{ background: MODE[b.mode].color }}
            >
              {b.line} → {short(b.to)} ₹{b.fare}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
