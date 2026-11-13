import { useEffect, useRef, useState } from "react";
import { formatClock, formatDuration, minutesLeft } from "@/game/clock";
import { PLACES } from "@/game/map";
import { CHECKIN_CLOSES, ITEMS, TRANSPORT } from "@/game/rules";
import type { ItemId, Outcome } from "@/game/types";
import type { PublicState } from "@/game/view";
import RouteMap from "./RouteMap";
import Scene from "./Scene";

/** Roll a number towards its new value instead of snapping, so every change is seen. */
function useTween(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = Math.round(start + (target - start) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function bagSummary(items: ItemId[]): string {
  if (!items.length) return "Empty";
  const counts = new Map<ItemId, number>();
  items.forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1));
  return [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ""}${ITEMS[id].label}`).join(", ");
}

function Pop({ turn, text, tone }: { turn: number; text: string | null; tone: string }) {
  if (!text) return null;
  return (
    <span key={turn} className={`animate-pop pointer-events-none absolute -top-3 right-0 font-mono text-xs font-semibold ${tone}`}>
      {text}
    </span>
  );
}

function Stat({ label, children, sub, tone = "normal", pop, tint }: {
  tint: string;
  label: string;
  children: React.ReactNode;
  sub: string;
  tone?: "normal" | "warn" | "critical";
  pop?: React.ReactNode;
}) {
  const color = tone === "critical" ? "text-brake" : tone === "warn" ? "text-sodium" : "text-paper";
  return (
    <div className={`relative min-w-0 rounded-md px-3 py-2 ${tint}`}>
      {pop}
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</div>
      <div className={`truncate font-mono text-lg tabular-nums leading-tight ${color} ${tone === "critical" ? "animate-pulse-soft" : ""}`}>
        {children}
      </div>
      <div className="hidden truncate text-[11px] text-muted sm:block">{sub}</div>
    </div>
  );
}

export default function Hud({ state, delta }: { state: PublicState; delta: Outcome["delta"] | null }) {
  const minutes = useTween(state.minutes);
  const cash = useTween(state.cash);
  const battery = useTween(state.battery);
  const [mapOpen, setMapOpen] = useState(false);
  const left = minutesLeft(state.minutes);
  const urgent = left <= 15;
  const clockColor = urgent ? "text-brake" : left <= 30 ? "text-sodium" : "text-paper";
  const fuse = urgent ? "bg-brake" : left <= 30 ? "bg-sodium" : "bg-go";
  const batteryTone = state.battery === 0 ? "critical" : state.battery <= 10 ? "warn" : "normal";

  return (
    <section aria-label="Your situation" className="sticky top-0 z-20 self-start px-3 pt-3 max-lg:w-full">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border-2 border-line bg-panel p-3 sm:p-4">
        {/* Phones get a shorter strip of the street (cropped from the top), so the story keeps most of the screen. */}
        <div className="-mx-3 -mt-3 mb-3 h-28 sm:-mx-4 sm:-mt-4 sm:h-36 lg:h-auto">
          <Scene state={state} />
        </div>
        <div className="relative flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">Right now</div>
            <div className={`whitespace-nowrap font-display text-4xl tabular-nums leading-none sm:text-5xl lg:text-4xl ${clockColor} ${urgent ? "animate-pulse-soft" : ""}`}>
              {formatClock(minutes)}
            </div>
          </div>
          <div className="relative text-right">
            <Pop turn={state.turn} text={delta ? `+${delta.minutes} min gone` : null} tone="text-sodium" />
            <div className={`font-mono text-xl tabular-nums leading-none sm:text-2xl ${clockColor}`}>
              {left > 0 ? formatDuration(left) : "Closed"}
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">until check-in closes</div>
          </div>
        </div>

        {/* The fuse: how much of the evening is left. */}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-night" aria-hidden>
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${fuse}`}
            style={{ width: `${Math.max(0, Math.min(100, (100 * left) / CHECKIN_CLOSES))}%` }}
          />
        </div>

        <div className="mt-3 grid grid-cols-[1fr_1fr_1.35fr] gap-2">
          <Stat
            label="Battery"
            tint="bg-night text-muted"
            tone={batteryTone}
            sub={state.battery > 0 ? "Apps and calls work" : "Dead: no apps, no calls"}
            pop={<Pop turn={state.turn} text={delta?.battery ? `${delta.battery > 0 ? "+" : "−"}${Math.abs(delta.battery)}%` : null} tone={delta && delta.battery > 0 ? "text-go" : "text-muted"} />}
          >
            {battery}%
            <span className="ml-2 hidden h-2 w-10 overflow-hidden rounded-sm bg-line align-middle sm:inline-block lg:hidden">
              <span className={`block h-full transition-all duration-700 ${state.battery <= 10 ? "bg-brake" : "bg-go"}`} style={{ width: `${state.battery}%` }} />
            </span>
          </Stat>
          <Stat
            label="Cash"
            tint="bg-night text-muted"
            tone={state.cash < 50 ? "warn" : "normal"}
            sub={state.quote ? `Auto asking ₹${state.quote.ask}` : "Spend it wisely"}
            pop={<Pop turn={state.turn} text={delta?.cash ? `${delta.cash > 0 ? "+" : "−"}₹${Math.abs(delta.cash)}` : null} tone={delta && delta.cash > 0 ? "text-go" : "text-brake"} />}
          >
            ₹{cash}
          </Stat>
          <Stat label="Bag" tint="bg-night text-muted" sub={state.raining ? "It's raining" : "Dry, for now"}>
            <span className="text-sm">{bagSummary(state.inventory)}</span>
          </Stat>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted">
            <span className="text-paper">{PLACES[state.location].name}</span>
            {state.ride && (
              <>
                {" · "}in a {TRANSPORT[state.ride.transport].label} to {PLACES[state.ride.destination].short}
              </>
            )}
          </p>
          {/* On phones the map is one tap away; on wide screens it is always open. */}
          <button
            type="button"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((v) => !v)}
            className="shrink-0 rounded-md border border-sodium/60 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-sodium lg:hidden"
          >
            {mapOpen ? "Hide map" : "Map"}
          </button>
        </div>
        <div className={`mt-2 ${mapOpen ? "" : "max-lg:hidden"}`}>
          <RouteMap state={state} />
        </div>
      </div>
    </section>
  );
}
