// The street, drawn from game state: where you are, what you're riding, the weather and how late it is.
// It only reads state. Buildings and the road scroll while a ride is carrying you; on foot you're in the jam.
import type { CSSProperties } from "react";
import { PLACES, kmToAirport } from "@/game/map";
import { CHECKIN_CLOSES } from "@/game/rules";
import { TRANSPORT } from "@/game/rules";
import type { Transport } from "@/game/types";
import type { PublicState } from "@/game/view";

const WINDOW = ["#ffd23f", "#ffb347", "#fff3c4"];
const FAR = Array.from({ length: 16 }, (_, i) => ({ x: i * 44, w: 38, h: 34 + ((i * 37) % 52) }));
const NEAR = Array.from({ length: 10 }, (_, i) => ({ x: i * 88, w: 62, h: 52 + ((i * 53) % 44) }));
const FAR_PERIOD = 16 * 44;
const NEAR_PERIOD = 10 * 88;
const GROUND = 150;
// Flat bands, like a screen-printed travel poster: no gradients.
const DUSK = ["#3b1d6e", "#7a2a78", "#c2377f", "#f0683f", "#ffa23c"];
const NIGHT = ["#070b1f", "#0c1029", "#121433", "#19173d", "#211a47"];

function Bands({ colors }: { colors: string[] }) {
  const h = GROUND / colors.length;
  return (
    <>
      {colors.map((c, i) => (
        <rect key={c} y={i * h} width={640} height={h + 1} fill={c} />
      ))}
    </>
  );
}

function Wheel({ x, r = 6 }: { x: number; r?: number }) {
  return (
    <>
      <circle cx={x} cy={-r} r={r} fill="#0b0d10" />
      <circle cx={x} cy={-r} r={r / 2.5} fill="#8b919b" />
    </>
  );
}

function Headlight({ x, y }: { x: number; y: number }) {
  return (
    <>
      <path d={`M${x} ${y} l70 -10 v24 z`} fill="#ffe9a8" opacity={0.14} />
      <circle cx={x} cy={y} r={2.5} fill="#ffe9a8" />
    </>
  );
}

function Auto() {
  return (
    <g>
      <path d="M6 -24 Q8 -46 34 -46 H52 Q61 -46 63 -24 Z" fill="#ffd23f" />
      <path d="M46 -42 H53 Q57 -41 59 -26 H46 Z" fill="#9be7ff" opacity={0.85} />
      <circle cx={38} cy={-33} r={4.5} fill="#2a1f3d" />
      <circle cx={20} cy={-33} r={4.5} fill="#ece8e1" />
      <rect x={0} y={-26} width={68} height={17} rx={5} fill="#1faa59" />
      <rect x={0} y={-17} width={68} height={3} fill="#ffd23f" />
      <rect x={0} y={-24} width={3} height={6} rx={1} fill="#ff5a4f" />
      <Wheel x={13} />
      <Wheel x={56} />
      <Headlight x={68} y={-18} />
    </g>
  );
}

function Cab() {
  return (
    <g>
      <path d="M14 -20 L24 -35 H54 L66 -20 Z" fill="#f4f1ea" />
      <path d="M19 -21 L27 -32 H38 V-21 Z M41 -21 V-32 H52 L61 -21 Z" fill="#9be7ff" opacity={0.85} />
      <rect x={33} y={-41} width={14} height={6} rx={2} fill="#ffd23f" />
      <rect x={0} y={-22} width={80} height={14} rx={5} fill="#f4f1ea" />
      <rect x={0} y={-14} width={80} height={3} fill="#ffd23f" />
      <rect x={0} y={-20} width={3} height={6} rx={1} fill="#ff5a4f" />
      <Wheel x={17} />
      <Wheel x={63} />
      <Headlight x={80} y={-16} />
    </g>
  );
}

function Bike() {
  return (
    <g strokeLinecap="round">
      <circle cx={8} cy={-8} r={8} fill="none" stroke="#0b0d10" strokeWidth={4} />
      <circle cx={50} cy={-8} r={8} fill="none" stroke="#0b0d10" strokeWidth={4} />
      <path d="M8 -8 L22 -22 H38 L50 -8 M38 -22 L44 -32" fill="none" stroke="#2f6fb3" strokeWidth={4} />
      <rect x={12} y={-27} width={24} height={5} rx={2.5} fill="#2a1f3d" />
      {/* rider, then you on the back */}
      <path d="M32 -27 L36 -44 L44 -33" fill="none" stroke="#b3362b" strokeWidth={5} />
      <circle cx={37} cy={-50} r={5.5} fill="#ffd23f" />
      <path d="M19 -27 L22 -42" fill="none" stroke="#ece8e1" strokeWidth={5} />
      <circle cx={22} cy={-48} r={5} fill="#ece8e1" />
      <Headlight x={52} y={-30} />
    </g>
  );
}

interface BusProps {
  /** Route number on the LED board, e.g. "500-D" or "KIA-8". */
  line?: string;
}

/** Ordinary BMTC city bus, route number in the window. */
function CityBus({ line = "BMTC" }: BusProps) {
  return (
    <g>
      <rect x={0} y={-46} width={128} height={38} rx={6} fill="#e23b3b" />
      <rect x={6} y={-40} width={108} height={14} rx={2} fill="#9be7ff" opacity={0.85} />
      {[30, 54, 78, 102].map((x) => (
        <rect key={x} x={x} y={-40} width={2} height={14} fill="#e23b3b" />
      ))}
      <rect x={104} y={-44} width={22} height={7} rx={1} fill="#0F172A" />
      <text x={115} y={-38.6} textAnchor="middle" fontSize={5.5} fontWeight="bold" fill="#F59E0B" fontFamily="monospace">
        {line}
      </text>
      <rect x={0} y={-20} width={128} height={3} fill="#f4f1ea" />
      <rect x={0} y={-42} width={3} height={8} rx={1} fill="#ff5a4f" />
      <Wheel x={26} r={7} />
      <Wheel x={100} r={7} />
      <Headlight x={128} y={-16} />
    </g>
  );
}

/** Vajra (city AC) in deep teal; Vayu Vajra (airport) in sky blue with a ✈ on the board. */
const VajraBus = ({ line = "V-500D" }: BusProps) => <Volvo body="#0E7490" trim="#22D3EE" board={line} gradientId="vajra-headlight" />;
const VayuVajraBus = ({ line = "KIA-8" }: BusProps) => <Volvo body="#0284C7" trim="#38BDF8" board={`${line}✈`} gradientId="vayu-headlight" />;

/** BMTC Volvo coach. Drawn at 96 wide, scaled so its wheels sit on the road. */
function Volvo({ body, trim, board, gradientId }: { body: string; trim: string; board: string; gradientId: string }) {
  return (
    <g className="kia-bus-sprite" transform="translate(0 -47) scale(1.33)">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#FEF08A" />
          <stop offset="1" stopColor="#FEF08A" stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Headlight beam */}
      <polygon points="96,24 165,12 165,36" fill={`url(#${gradientId})`} opacity={0.35} />
      {/* Shadow */}
      <ellipse cx={48} cy={34} rx={46} ry={3} fill="#000000" opacity={0.45} />

      {/* Roof AC pod */}
      <rect x={18} y={0} width={44} height={5} rx={2.5} fill="#E2E8F0" />
      <rect x={24} y={1} width={32} height={2} rx={1} fill="#94A3B8" />

      {/* Coach body, Vayu Vajra sky blue */}
      <rect x={0} y={4} width={96} height={26} rx={5} fill={body} stroke={trim} strokeWidth={1} />

      {/* White swoosh along the bottom */}
      <path d="M 2 23 Q 45 20 95 24 L 95 28 L 2 28 Z" fill="#F8FAFC" />
      <rect x={0} y={26} width={96} height={3} rx={1.5} fill="#0369A1" />

      {/* Amber LED route board */}
      <rect x={70} y={6} width={22} height={5} rx={1} fill="#0F172A" />
      <text x={72} y={10} fontSize={4.2} fontWeight="bold" fill="#F59E0B" fontFamily="monospace">
        {board}
      </text>

      {/* Tinted AC windows */}
      <rect x={6} y={8} width={60} height={11} rx={2} fill="#0F172A" />
      {[7, 22, 37, 52].map((x) => (
        <rect key={x} x={x} y={9} width={13} height={9} rx={1} fill="#38BDF8" opacity={0.75} />
      ))}
      {/* Driver's cabin window */}
      <path d="M 70 12 L 93 12 L 95 19 L 70 19 Z" fill="#7DD3FC" opacity={0.85} />

      {/* Headlight and taillight */}
      <circle cx={95} cy={24} r={2.2} fill="#FEF08A" />
      <rect x={0} y={20} width={2} height={5} rx={1} fill="#EF4444" />

      {/* Wheels with silver hubs */}
      <circle cx={22} cy={30} r={5.5} fill="#0F172A" />
      <circle cx={22} cy={30} r={2.5} fill="#CBD5E1" />
      <circle cx={74} cy={30} r={5.5} fill="#0F172A" />
      <circle cx={74} cy={30} r={2.5} fill="#CBD5E1" />
    </g>
  );
}

function Walker({ umbrella }: { umbrella: boolean }) {
  return (
    <g strokeLinecap="round" fill="none">
      <path d="M10 -16 L5 0 M10 -16 L16 0" stroke="#ece8e1" strokeWidth={4} />
      <path d="M10 -32 V-16 M10 -28 L18 -20" stroke="#b3362b" strokeWidth={5} />
      <rect x={1} y={-31} width={7} height={12} rx={2} fill="#2f6fb3" />
      <circle cx={10} cy={-38} r={5.5} fill="#ece8e1" />
      {umbrella && (
        <>
          <path d="M18 -20 V-52" stroke="#ece8e1" strokeWidth={1.5} />
          <path d="M-4 -50 Q18 -72 40 -50 Z" fill="#ffd23f" />
        </>
      )}
    </g>
  );
}

const VEHICLE: Record<Transport, (p: BusProps) => React.ReactNode> = {
  auto: Auto,
  cab: Cab,
  bike_taxi: Bike,
  bus: CityBus,
  ac_bus: VajraBus,
  airport_bus: VayuVajraBus,
  lift: Cab, // a stranger's car
};

function JamCar({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M10 -16 L17 -27 H38 L46 -16 Z" fill={color} />
      <rect x={0} y={-18} width={56} height={12} rx={4} fill={color} />
      <rect x={0} y={-16} width={3.5} height={6} rx={1} fill="#ff5a4f" className="animate-pulse-soft" />
      <circle cx={-2} cy={-13} r={7} fill="#ff5a4f" opacity={0.25} className="animate-pulse-soft" />
      <Wheel x={12} r={5} />
      <Wheel x={44} r={5} />
    </g>
  );
}

export default function Scene({ state }: { state: PublicState }) {
  const late = Math.min(1, state.minutes / CHECKIN_CLOSES);
  const moving = state.ride !== null && state.status === "playing";
  const atAirport = state.location === "airport";
  const Vehicle = state.ride ? VEHICLE[state.ride.transport] : null;
  const place = PLACES[state.location];

  return (
    <svg
      viewBox="0 0 480 200"
      role="img"
      aria-label={`${place.name}${state.raining ? ", in the rain" : ""}. ${state.ride ? `You are in a ${state.ride.line ? `${state.ride.line} ` : ""}${TRANSPORT[state.ride.transport].label}.` : "You are on foot in the traffic."}`}
      preserveAspectRatio="xMidYMax slice"
      className={`block h-full w-full lg:h-auto ${moving ? "scene-moving" : ""}`}
    >

      {/* Sky: dusk at 7:00, full night by the time check-in closes. */}
      <Bands colors={NIGHT} />
      <g opacity={state.raining ? 0.25 * (1 - late) : 1 - late} className="transition-opacity duration-1000">
        <Bands colors={DUSK} />
      </g>
      {[[60, 24], [140, 46], [230, 18], [330, 38], [410, 14], [500, 52], [600, 22]].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r={1.2} fill="#fff" opacity={state.raining ? 0 : late} />
      ))}
      {!state.raining && <circle cx={250} cy={30} r={13} fill="#fff3c4" opacity={0.35 + 0.65 * late} />}
      {state.raining && (
        <>
          <g fill="#3a3f55" opacity={0.9}>
            <ellipse cx={120} cy={18} rx={110} ry={22} />
            <ellipse cx={330} cy={10} rx={130} ry={24} />
            <ellipse cx={540} cy={20} rx={120} ry={22} />
          </g>
          <rect width={640} height={GROUND} fill="#fff" className="scene-lightning" />
        </>
      )}

      {/* Far skyline */}
      <g className="scene-layer" style={{ "--period": `-${FAR_PERIOD}px`, "--speed": "38s" } as CSSProperties}>
        {[0, FAR_PERIOD].map((dx) => (
          <g key={dx} transform={`translate(${dx} 0)`} fill="#2a1a52">
            {FAR.map((b) => (
              <rect key={b.x} x={b.x} y={GROUND - b.h} width={b.w} height={b.h} />
            ))}
          </g>
        ))}
      </g>

      {/* Near buildings with lit windows; at the airport, the terminal instead. */}
      {atAirport ? (
        <g>
          <path d="M40 150 V96 Q200 60 360 96 V150 Z" fill="#15324a" />
          <path d="M52 150 V104 Q200 72 348 104 V150 Z" fill="#2f6fb3" opacity={0.35} />
          {[90, 140, 190, 240, 290].map((x) => (
            <rect key={x} x={x} y={100} width={3} height={50} fill="#15324a" />
          ))}
          <text x={200} y={136} textAnchor="middle" fill="#fff" fontSize={15} fontWeight={700} letterSpacing={3} className="font-mono">
            DEPARTURES
          </text>
          <g className="scene-takeoff" fill="#ece8e1">
            <path d="M300 66 h52 q10 0 14 5 q-4 5 -14 5 h-52 q-6 -5 0 -10 z" />
            <path d="M304 67 l-10 -14 h8 l12 14 z M326 74 l-14 16 h9 l20 -16 z" />
          </g>
        </g>
      ) : (
        <g className="scene-layer" style={{ "--period": `-${NEAR_PERIOD}px`, "--speed": "14s" } as CSSProperties}>
          {[0, NEAR_PERIOD].map((dx) => (
            <g key={dx} transform={`translate(${dx} 0)`}>
              {NEAR.map((b, i) => (
                <g key={b.x}>
                  <rect x={b.x} y={GROUND - b.h} width={b.w} height={b.h} fill="#1a1238" />
                  {Array.from({ length: Math.floor(b.h / 16) }, (_, r) =>
                    [0, 1, 2].map((c) =>
                      (i + r * 2 + c) % 3 === 0 ? null : (
                        <rect
                          key={`${r}-${c}`}
                          x={b.x + 8 + c * 17}
                          y={GROUND - b.h + 8 + r * 16}
                          width={10}
                          height={8}
                          fill={WINDOW[(i + r + c) % 3]}
                          opacity={0.35 + 0.5 * late}
                        />
                      ),
                    ),
                  )}
                </g>
              ))}
            </g>
          ))}
        </g>
      )}

      {/* The green highway board: where you are, and how far the airport still is. */}
      <g transform="translate(-150 0)">
        <rect x={468} y={104} width={4} height={46} fill="#8b919b" />
        <rect x={592} y={104} width={4} height={46} fill="#8b919b" />
        <rect x={446} y={58} width={172} height={48} rx={5} fill="#0b7a4b" stroke="#f4f1ea" strokeWidth={2} />
        <text x={532} y={80} textAnchor="middle" fill="#fff" fontSize={14} letterSpacing={0.5} className="font-display">
          {place.short.toUpperCase()}
        </text>
        <text x={532} y={97} textAnchor="middle" fill="#ffd23f" fontSize={10.5} fontWeight={600} letterSpacing={1} className="font-mono">
          {atAirport ? "CHECK-IN INSIDE →" : `✈ AIRPORT ${kmToAirport(state.location)} KM`}
        </text>
      </g>

      {/* Road */}
      <rect y={GROUND} width={640} height={50} fill="#14111f" />
      <rect y={GROUND} width={640} height={2} fill="#3a2f66" />
      <line x1={0} y1={174} x2={640} y2={174} stroke="#ffd23f" strokeWidth={2} strokeDasharray="24 24" opacity={0.7} className="scene-dash" />
      {state.raining && <rect y={GROUND} width={640} height={50} fill="#2f6fb3" opacity={0.08} />}

      {/* On foot you stand in the jam; in a ride, the jam is what slides past. */}
      {!moving && !atAirport && (
        <>
          <JamCar x={40} y={170} color="#5d6672" />
          <JamCar x={250} y={170} color="#b3362b" />
          <JamCar x={330} y={170} color="#2f6fb3" />
          <JamCar x={300} y={194} color="#f4f1ea" />
          <JamCar x={380} y={194} color="#ffd23f" />
          <JamCar x={500} y={194} color="#5d6672" />
        </>
      )}
      {moving && (
        <g stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.35} className="scene-streaks">
          <line x1={60} y1={160} x2={110} y2={160} />
          <line x1={20} y1={186} x2={90} y2={186} />
          <line x1={90} y1={196} x2={130} y2={196} />
        </g>
      )}

      <g transform={`translate(${Vehicle ? 170 : 180} 194)`}>
        <g className={moving ? "scene-bob" : ""}>{Vehicle ? <Vehicle line={state.ride?.line} /> : <Walker umbrella={state.raining && state.inventory.includes("umbrella")} />}</g>
      </g>
    </svg>
  );
}
