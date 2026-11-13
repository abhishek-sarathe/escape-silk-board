"use client";

// Cheerful metro-style map of the evening. It draws the game's real road graph (EDGES), so every
// road on it is one the engine will actually let you take. Decoration only: reads state, never changes it.
import { EDGES, PLACES, edgeBetween, kmToAirport, neighbors, route } from "@/game/map";
import { LOCATION_IDS, type LocationId, type Transport } from "@/game/types";
import type { PublicState } from "@/game/view";

interface Node {
  label: string;
  sub: string;
  x: number;
  y: number;
  emoji: string;
  vibe: string;
  color: string;
}

const NODES: Record<LocationId, Node> = {
  silk_board: {
    label: "Silk Board",
    sub: "5-Flyover Boss",
    x: 60,
    y: 150,
    emoji: "🚦",
    vibe: "Five flyovers, zero movement. Auto annas quote prices here with a perfectly straight face.",
    color: "#F59E0B",
  },
  koramangala: {
    label: "Koramangala",
    sub: "Sony World signal",
    x: 170,
    y: 95,
    emoji: "☕",
    vibe: "Filter coffee aroma, startup pitches at every table, and 180-second red lights.",
    color: "#10B981",
  },
  mg_road: {
    label: "MG Road",
    sub: "Indiranagar side",
    x: 300,
    y: 80,
    emoji: "🚇",
    vibe: "The Purple Line hums overhead. Tonight you're on the road below it, guru.",
    color: "#8B5CF6",
  },
  hsr: {
    label: "HSR",
    sub: "Agara, ORR starts here",
    x: 170,
    y: 205,
    emoji: "💻",
    vibe: "Start of the Outer Ring Road. The blue airport buses stop here.",
    color: "#3B82F6",
  },
  marathahalli: {
    label: "Marathahalli",
    sub: "Bellandur ORR",
    x: 300,
    y: 215,
    emoji: "🌊",
    vibe: "Every tech park in the city emptying onto one bridge. Ten minutes of rain and it's Venice.",
    color: "#EC4899",
  },
  kr_puram: {
    label: "KR Puram",
    sub: "Tin Factory",
    x: 430,
    y: 205,
    emoji: "🚧",
    vibe: "Metro barricades, bus bays and a lot of honking. Where buses go to reflect on their choices.",
    color: "#F97316",
  },
  hebbal: {
    label: "Hebbal",
    sub: "flyover, Esteem Mall merge",
    x: 470,
    y: 75,
    emoji: "🛣️",
    vibe: "The Great North Merge! Every road to the airport meets here.",
    color: "#EAB308",
  },
  yelahanka: {
    label: "Yelahanka",
    sub: "Airport Road",
    x: 610,
    y: 75,
    emoji: "🚌",
    vibe: "Six lanes and, suddenly, speed. The Vayu Vajra becomes a royal chariot.",
    color: "#22C55E",
  },
  hennur: {
    label: "Hennur",
    sub: "Hennur-Bagalur road",
    x: 470,
    y: 145,
    emoji: "🧭",
    vibe: "Kalyan Nagar's cafés on one side, the Hennur-Bagalur road on the other: the locals' shortcut to the airport.",
    color: "#0EA5E9",
  },
  hoskote: {
    label: "Hoskote",
    sub: "Old Madras Road",
    x: 610,
    y: 215,
    emoji: "🌾",
    vibe: "Past the city on Old Madras Road, then a quiet state highway to the airport's back side. No toll.",
    color: "#84CC16",
  },
  airport: {
    label: "KIA T2",
    sub: "Terminal 2 departures",
    x: 750,
    y: 150,
    emoji: "✈️",
    vibe: "The bamboo-garden terminal! Sprint for the DigiYatra gate and the counter.",
    color: "#14B8A6",
  },
};

const AUTO_YELLOW = "#F59E0B";
const METRO_GREEN = "#16A34A";

function vehicle(transport: Transport | null): string {
  switch (transport) {
    case "auto":
      return "🛺";
    case "cab":
      return "🚕";
    case "bike_taxi":
      return "🛵";
    case "bus":
    case "ac_bus":
      return "🚌";
    case "airport_bus":
      return "🚍";
    case "lift":
      return "🚗";
    default:
      return "🚶";
  }
}

const seg = (a: LocationId, b: LocationId) => ({ x1: NODES[a].x, y1: NODES[a].y, x2: NODES[b].x, y2: NODES[b].y });
const key = (a: LocationId, b: LocationId) => [a, b].sort().join("|");

export function BengaluruMap({ state }: { state: PublicState }) {
  const here = state.location;
  const active = NODES[here];
  const playing = state.status === "playing";
  const won = state.status === "won";
  const sprite = won ? "🎉" : state.status === "lost" ? "😅" : vehicle(state.ride?.transport ?? null);
  const progress = won ? METRO_GREEN : AUTO_YELLOW;

  // Roads already travelled, in the order you took them.
  const travelled = new Set<string>();
  for (let i = 1; i < state.visited.length; i++) {
    if (edgeBetween(state.visited[i - 1], state.visited[i])) travelled.add(key(state.visited[i - 1], state.visited[i]));
  }
  // The stretch still ahead of the vehicle you're in.
  // A bus follows its real line, so draw the line's own stops; other rides take the quickest road.
  const ahead = state.ride ? (state.ride.path ?? route(here, state.ride.destination, state.ride.transport) ?? []) : [];
  const branches = playing && !state.ride ? neighbors(here).map((to) => ({ to, edge: edgeBetween(here, to)! })) : [];
  const dist = kmToAirport(here);

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/80 bg-gradient-to-br from-amber-50 via-white to-sky-50 p-3 text-slate-900 shadow-md sm:p-4">
      {/* Header + weather pill */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-slate-900 shadow-sm">
            🛺 NAMMA RADAR LIVE
          </span>
          <span className="truncate text-xs font-semibold text-slate-700">
            Now at: <strong className="text-slate-900">{active.label}</strong> ({active.sub})
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold ${
            state.raining ? "animate-hop bg-sky-600 text-white" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {state.raining ? "🌧️ Sudden Bengaluru downpour!" : "🌤️ Pleasant evening breeze"}
        </div>
      </div>

      <svg
        viewBox="0 0 800 280"
        role="img"
        aria-label={`Route map. You are at ${PLACES[here].name}, ${dist} km from the airport.`}
        className="block h-auto w-full select-none"
      >
        <defs>
          <pattern id="bm-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#E2E8F0" strokeWidth="0.7" />
          </pattern>
        </defs>
        <rect width="800" height="280" fill="url(#bm-grid)" rx="12" />

        {/* Corridor labels */}
        <text x="400" y="22" textAnchor="middle" fontSize="17" fontWeight="700" fill="#7C3AED">
          🏙️ CITY CENTRE: Koramangala, MG Road, then Hebbal (NH-44, toll) or Hennur
        </text>
        <text x="400" y="274" textAnchor="middle" fontSize="17" fontWeight="700" fill="#DB2777">
          🚌 RING ROAD (KIA-8, 500-D) or the toll-free back way via Hoskote
        </text>

        {/* Every road, then the ones you've taken, then the ones you could take next */}
        {EDGES.map((e) => {
          const done = travelled.has(key(e.a, e.b));
          const next = branches.some((b) => key(here, b.to) === key(e.a, e.b));
          return (
            <line
              key={key(e.a, e.b)}
              {...seg(e.a, e.b)}
              stroke={done ? progress : next ? AUTO_YELLOW : "#CBD5E1"}
              strokeWidth={done ? 6 : next ? 5 : 3.5}
              strokeLinecap="round"
              className={next && !done ? "route-line-active" : ""}
            />
          );
        })}
        {ahead.slice(1).map((to, i) => (
          <line
            key={`ahead-${to}`}
            {...seg(ahead[i], to)}
            stroke={AUTO_YELLOW}
            strokeWidth={5}
            strokeLinecap="round"
            className="route-line-active"
          />
        ))}

        {LOCATION_IDS.map((id) => {
          const node = NODES[id];
          const current = id === here;
          const seen = state.visited.includes(id);
          return (
            <g key={id} transform={`translate(${node.x}, ${node.y})`}>
              {current && <circle r={30} fill={node.color} opacity={0.22} className="animate-pulse-soft" />}
              <circle
                r={current ? 21 : 15}
                fill={current ? node.color : seen ? "#FEF3C7" : "#FFFFFF"}
                stroke={node.color}
                strokeWidth={3}
              />
              <text textAnchor="middle" dy={6} fontSize={current ? 20 : 15}>
                {node.emoji}
              </text>
              {current && (
                <text textAnchor="middle" y={-28} fontSize={28} className={playing ? "auto-sprite" : ""}>
                  {sprite}
                </text>
              )}
              <text
                textAnchor="middle"
                y={42}
                fontSize={19}
                fontWeight={current ? 800 : 600}
                fill={current ? "#0F172A" : seen ? "#334155" : "#64748B"}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Where you can go from here */}
      {playing && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {state.ride ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-300">
              {sprite} {state.ride.line ? `${state.ride.line} to` : "Riding to"} {NODES[state.ride.destination].label} {NODES[state.ride.destination].emoji}
            </span>
          ) : (
            <>
              <span className="font-semibold uppercase tracking-wide text-slate-500">From here:</span>
              {branches.map(({ to, edge }) => (
                <span
                  key={to}
                  className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${
                    state.visited.includes(to) ? "bg-white text-slate-500 ring-slate-200" : "bg-amber-50 text-slate-800 ring-amber-300"
                  }`}
                >
                  {NODES[to].emoji} {NODES[to].label} · {edge.km} km
                </span>
              ))}
            </>
          )}
        </div>
      )}

      {/* Local lore bar */}
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-100/80 px-3 py-2 text-xs text-amber-950">
        <span>
          <strong>📍 Local intel:</strong> {active.vibe}
        </span>
        <span className="hidden shrink-0 font-bold text-amber-800 sm:inline">
          {dist === 0 ? "Counter's inside! 🏃" : `${dist} km to go ✈️`}
        </span>
      </div>
    </div>
  );
}
