import { useEffect, useRef, useState } from "react";
import { formatClock, formatDuration, minutesLeft } from "@/game/clock";
import { PLACES } from "@/game/map";
import { CHECKIN_CLOSES, ITEMS, TRANSPORT } from "@/game/rules";
import type { ItemId, Outcome } from "@/game/types";
import type { PublicState } from "@/game/view";
import { BengaluruMap } from "./BengaluruMap";
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

const ITEM_ICONS: Record<ItemId, string> = {
  samosa: "🫓",
  chai: "☕",
  coffee: "☕",
  water: "💧",
  umbrella: "☂️",
};

function bagSummary(items: ItemId[]): string {
  if (!items.length) return "Empty 📭";
  const counts = new Map<ItemId, number>();
  items.forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1));
  return [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ""}${ITEMS[id].label} ${ITEM_ICONS[id] ?? ""}`).join(", ");
}

function Pop({ turn, text, tone }: { turn: number; text: string | null; tone: string }) {
  if (!text) return null;
  return (
    <span key={turn} className={`animate-pop pointer-events-none absolute -top-3 right-0 font-mono text-xs font-semibold ${tone}`}>
      {text}
    </span>
  );
}

/** A phone battery, drawn like the one in a status bar: outline, cap, and a fill that matches the level. */
function BatteryIcon({ level }: { level: number }) {
  const fill = level === 0 ? "bg-transparent" : level <= 10 ? "bg-brake" : level <= 30 ? "bg-sodium" : "bg-go";
  const frame = level === 0 ? "border-brake" : "border-paper/70";
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center">
      <span className={`relative inline-block h-4 w-7 rounded-[4px] sm:h-[18px] sm:w-9 border-2 p-[2px] ${frame}`}>
        <span className={`block h-full rounded-[2px] transition-all duration-700 ${fill}`} style={{ width: `${Math.max(level, 0)}%` }} />
        {level === 0 && <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold leading-none text-brake">✕</span>}
      </span>
      <span className={`ml-[1px] h-2 w-[3px] rounded-r-sm ${level === 0 ? "bg-brake" : "bg-paper/70"}`} />
    </span>
  );
}

/** What the battery level means for the player, in a few words. */
function batteryNote(level: number): string {
  if (level === 0) return "Dead: no apps";
  if (level <= 10) return "Charge soon!";
  if (level <= 30) return "Getting low";
  return "Apps work";
}

/** One small icon-and-value chip for the compact view. */
function Chip({ label, children, tone = "normal", pop }: { label: string; children: React.ReactNode; tone?: "normal" | "warn" | "critical"; pop?: React.ReactNode }) {
  const color = tone === "critical" ? "text-brake ring-brake" : tone === "warn" ? "text-sodium ring-sodium" : "text-paper ring-transparent";
  return (
    <span aria-label={label} className={`relative inline-flex min-w-0 items-center gap-1.5 rounded-md bg-night px-2 py-1.5 font-mono text-sm tabular-nums ring-1 ${color}`}>
      {pop}
      {children}
    </span>
  );
}

/** Remembers the compact choice in this browser only; storage can be blocked, so every access is guarded. */
const COMPACT_KEY = "escape-silk-board:compact-card";
function readCompact(): boolean {
  try {
    // Compact is the default; only an explicit choice of the full card turns it off.
    return window.localStorage.getItem(COMPACT_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveCompact(on: boolean) {
  try {
    window.localStorage.setItem(COMPACT_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts for this page only
  }
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
    <div className={`relative min-w-0 rounded-md px-2.5 py-2 sm:px-3 ${tint}`}>
      {pop}
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</div>
      <div className={`truncate font-mono text-lg tabular-nums leading-tight ${color}`}>
        {children}
      </div>
      <div className="truncate text-[10px] leading-tight text-muted sm:text-[11px]">{sub}</div>
    </div>
  );
}

export default function Hud({ state, delta }: { state: PublicState; delta: Outcome["delta"] | null }) {
  const minutes = useTween(state.minutes);
  const cash = useTween(state.cash);
  const battery = useTween(state.battery);
  const [mapOpen, setMapOpen] = useState(false);
  // The HUD only renders after the game loads in the browser, so reading storage here can't cause a
  // hydration mismatch.
  const [compact, setCompact] = useState(() => typeof window === "undefined" || readCompact());
  const toggleCompact = () =>
    setCompact((v) => {
      saveCompact(!v);
      return !v;
    });
  const left = minutesLeft(state.minutes);
  const playing = state.status === "playing";
  const urgent = playing && left <= 15;
  const hurry = playing && left <= 30;
  // Auto-yellow when it's getting close, Namma Metro purple in the final stretch. Never alarm red.
  const clockColor = urgent ? "text-metro" : hurry ? "text-sodium" : "text-paper";
  const fuse = urgent ? "bg-metro" : hurry ? "bg-sodium" : "bg-metro-green";
  const nudge = left <= 0 ? null : urgent ? "Machaa, hurry up! 🏃" : hurry ? "Chalo chalo! ⏱️" : null;
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
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              Right now
              {nudge && (
                <span
                  key={nudge}
                  className={`animate-rise rounded-full px-2 py-0.5 font-sans text-[10px] font-bold normal-case tracking-normal text-night ${urgent ? "bg-metro" : "bg-sodium"}`}
                >
                  {nudge}
                </span>
              )}
            </div>
            <div
              className={`inline-block origin-bottom-left whitespace-nowrap font-display text-4xl tabular-nums leading-none sm:text-5xl lg:text-4xl ${clockColor} ${urgent ? "animate-nudge" : ""}`}
            >
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

        {compact ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Chip
              label={`Phone battery ${state.battery}%. ${batteryNote(state.battery)}`}
              tone={batteryTone}
              pop={<Pop turn={state.turn} text={delta?.battery ? `${delta.battery > 0 ? "+" : "−"}${Math.abs(delta.battery)}%` : null} tone={delta && delta.battery > 0 ? "text-go" : "text-muted"} />}
            >
              <BatteryIcon level={battery} />
              {battery}%
            </Chip>
            <Chip
              label={`Money ₹${state.cash}`}
              tone={state.cash < 50 ? "warn" : "normal"}
              pop={<Pop turn={state.turn} text={delta?.cash ? `${delta.cash > 0 ? "+" : "−"}₹${Math.abs(delta.cash)}` : null} tone={delta && delta.cash > 0 ? "text-go" : "text-brake"} />}
            >
              <span aria-hidden>💵</span>₹{cash}
            </Chip>
            <Chip label={`Bag: ${bagSummary(state.inventory)}`}>
              <span aria-hidden className="tracking-widest">
                {state.inventory.length ? state.inventory.map((i) => ITEM_ICONS[i] ?? "•").join("") : "📭"}
              </span>
            </Chip>
            {state.quote && <span className="font-mono text-[11px] text-muted">Auto asks ₹{state.quote.ask}</span>}
            {state.raining && <span aria-label="Raining">🌧️</span>}
          </div>
        ) : (
        <div className="mt-3 grid grid-cols-[1.15fr_1fr_1.2fr] gap-2">
          <Stat
            label="Phone"
            tint={`bg-night text-muted ${state.battery === 0 ? "ring-1 ring-brake" : state.battery <= 10 ? "ring-1 ring-sodium" : ""}`}
            tone={batteryTone}
            sub={batteryNote(state.battery)}
            pop={<Pop turn={state.turn} text={delta?.battery ? `${delta.battery > 0 ? "+" : "−"}${Math.abs(delta.battery)}%` : null} tone={delta && delta.battery > 0 ? "text-go" : "text-muted"} />}
          >
            <span className="flex items-center gap-1.5 sm:gap-2" aria-label={`Phone battery ${state.battery}%`}>
              <BatteryIcon level={battery} />
              <span className={state.battery <= 10 ? "animate-pulse-soft" : ""}>{battery}%</span>
            </span>
          </Stat>
          <Stat
            label="Money"
            tint="bg-night text-muted"
            tone={state.cash < 50 ? "warn" : "normal"}
            sub={state.quote ? `Auto asks ₹${state.quote.ask}` : state.cash < 50 ? "Almost broke" : "In your wallet"}
            pop={<Pop turn={state.turn} text={delta?.cash ? `${delta.cash > 0 ? "+" : "−"}₹${Math.abs(delta.cash)}` : null} tone={delta && delta.cash > 0 ? "text-go" : "text-brake"} />}
          >
            ₹{cash}
          </Stat>
          <Stat label="Bag" tint="bg-night text-muted" sub={state.raining ? "It's raining" : "Dry, for now"}>
            <span className="block whitespace-normal text-xs font-semibold leading-tight">{bagSummary(state.inventory)}</span>
          </Stat>
        </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted">
            <span className="text-paper">{PLACES[state.location].name}</span>
            {state.ride && (
              <>
                {" · "}in the {state.ride.line ? `${state.ride.line} ` : ""}{TRANSPORT[state.ride.transport].label} to {PLACES[state.ride.destination].short}
              </>
            )}
          </p>
          <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            aria-pressed={compact}
            onClick={toggleCompact}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-paper"
          >
            {compact ? "Details" : "Compact"}
          </button>
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
        </div>
        <div className={`mt-2 ${mapOpen ? "" : "max-lg:hidden"}`}>
          <BengaluruMap state={state} />
        </div>
      </div>
    </section>
  );
}
