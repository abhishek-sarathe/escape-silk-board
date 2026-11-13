import { EDGES, PLACES, edgeBetween, neighbors, route } from "@/game/map";
import { LOCATION_IDS, type LocationId } from "@/game/types";
import type { PublicState } from "@/game/view";

// A transit-style map of the city, south (left) to north (right). Positions are for reading, not geography.
const AT: Record<LocationId, { x: number; y: number; labelY: number }> = {
  silk_board: { x: 40, y: 80, labelY: 106 },
  hsr: { x: 108, y: 122, labelY: 146 },
  koramangala: { x: 108, y: 38, labelY: 22 },
  marathahalli: { x: 204, y: 128, labelY: 152 },
  mg_road: { x: 204, y: 32, labelY: 16 },
  kr_puram: { x: 292, y: 116, labelY: 98 },
  hebbal: { x: 356, y: 78, labelY: 58 },
  yelahanka: { x: 424, y: 78, labelY: 104 },
  airport: { x: 486, y: 78, labelY: 58 },
};

const RING = "#4aa8ff";
const CENTRE = "#ff5a4f";
const AIRPORT_ROAD = "#3ecf8e";
const LINK = "#8b919b";

/** Which coloured line a stretch of road belongs to. */
function lineColor(a: LocationId, b: LocationId): string {
  const has = (id: LocationId) => a === id || b === id;
  if (has("yelahanka")) return AIRPORT_ROAD;
  if (has("hsr") && has("koramangala")) return LINK;
  if (has("koramangala") || has("mg_road")) return CENTRE;
  return RING;
}

const hasBus = (id: LocationId) => neighbors(id, "bus").length > 0;
const line = (a: LocationId, b: LocationId) => ({ x1: AT[a].x, y1: AT[a].y, x2: AT[b].x, y2: AT[b].y });

/** Pairs of places, in the order the player actually moved between them. */
function travelled(visited: LocationId[]): [LocationId, LocationId][] {
  const legs: [LocationId, LocationId][] = [];
  for (let i = 1; i < visited.length; i++) {
    if (edgeBetween(visited[i - 1], visited[i])) legs.push([visited[i - 1], visited[i]]);
  }
  return legs;
}

const LEGEND = [
  { x: 8, color: RING, label: "Ring Road" },
  { x: 112, color: CENTRE, label: "City centre" },
  { x: 228, color: AIRPORT_ROAD, label: "Airport road" },
];

export default function RouteMap({ state }: { state: PublicState }) {
  const legs = travelled(state.visited);
  const ahead = state.ride ? (route(state.location, state.ride.destination, state.ride.transport) ?? []) : [];
  const here = AT[state.location];
  const lost = state.status === "lost";

  return (
    <svg
      viewBox="0 0 520 188"
      role="img"
      aria-label={`Route map. You are at ${PLACES[state.location].name}. Visited: ${state.visited.map((v) => PLACES[v].short).join(", ")}.`}
      className="block h-auto w-full"
    >
      {/* Every road, faint, in its line's colour. */}
      {EDGES.map((e) => (
        <line key={`${e.a}-${e.b}`} {...line(e.a, e.b)} stroke={lineColor(e.a, e.b)} strokeWidth={6} strokeLinecap="round" opacity={0.25} />
      ))}

      {/* Where you've been: full colour, glowing. Each new stretch draws itself in once. */}
      {legs.map(([a, b]) => (
        <line
          key={`leg-${a}-${b}`}
          {...line(a, b)}
          pathLength={1}
          stroke={lineColor(a, b)}
          strokeWidth={6}
          strokeLinecap="round"
          className="animate-draw"

        />
      ))}

      {/* Where the current ride is still going. */}
      {ahead.slice(1).map((to, i) => (
        <line key={`ahead-${to}`} {...line(ahead[i], to)} stroke="#fff" strokeWidth={2} strokeDasharray="1 7" strokeLinecap="round" className="scene-dash-slow" />
      ))}

      {LOCATION_IDS.map((id) => {
        const p = AT[id];
        const seen = state.visited.includes(id);
        const isAirport = id === "airport";
        return (
          <g key={id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={isAirport ? 8 : 6}
              fill={isAirport ? AIRPORT_ROAD : hasBus(id) ? "#ece8e1" : "#0b0d10"}
              stroke={seen || isAirport ? "#fff" : "#0b0d10"}
              strokeWidth={2.5}
            />
            {isAirport && (
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11} fill="#0b0d10">
                ✈
              </text>
            )}
            <text
              x={p.x}
              y={p.labelY}
              textAnchor={id === "silk_board" ? "start" : isAirport ? "end" : "middle"}
              dx={id === "silk_board" ? -30 : isAirport ? 30 : 0}
              className={`font-mono text-[13px] uppercase ${id === state.location ? "fill-paper font-semibold" : seen ? "fill-paper/80" : "fill-muted"}`}
            >
              {PLACES[id].short}
            </text>
          </g>
        );
      })}

      {/* You. */}
      <g className="transition-transform duration-700 ease-out" style={{ transform: `translate(${here.x}px, ${here.y}px)` }}>
        <circle r={14} fill="#ffffff" opacity={0.3} className="animate-pulse-soft" />
        <circle r={6.5} fill={lost ? "#ff5a4f" : "#ffffff"} stroke="#0b0d10" strokeWidth={2} />
      </g>

      <g className="font-mono text-[10px] uppercase">
        {LEGEND.map((l) => (
          <g key={l.label}>
            <line x1={l.x} y1={178} x2={l.x + 18} y2={178} stroke={l.color} strokeWidth={5} strokeLinecap="round" />
            <text x={l.x + 25} y={181.5} className="fill-muted">
              {l.label}
            </text>
          </g>
        ))}
        <circle cx={368} cy={178} r={4.5} fill="#ece8e1" />
        <text x={378} y={181.5} className="fill-muted">
          Airport bus stops here
        </text>
      </g>
    </svg>
  );
}
