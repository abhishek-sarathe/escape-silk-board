import { formatClock, formatDuration, minutesLeft } from "@/game/clock";
import { PLACES, kmToAirport } from "@/game/map";
import { ITEMS, TRANSPORT } from "@/game/rules";
import type { ItemId } from "@/game/types";
import type { PublicState } from "@/game/view";

const TOTAL_KM = kmToAirport("silk_board");

function bagSummary(items: ItemId[]): string {
  if (!items.length) return "Empty";
  const counts = new Map<ItemId, number>();
  items.forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1));
  return [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ""}${ITEMS[id].label}`).join(", ");
}

function Stat({ label, children, sub, tone = "normal" }: {
  label: string;
  children: React.ReactNode;
  sub?: string;
  tone?: "normal" | "warn" | "critical";
}) {
  const color = tone === "critical" ? "text-brake" : tone === "warn" ? "text-sodium" : "text-paper";
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={`font-mono text-lg sm:text-xl tabular-nums leading-tight ${color} ${tone === "critical" ? "animate-pulse-soft" : ""}`}>
        {children}
      </div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export default function Hud({ state }: { state: PublicState }) {
  const left = minutesLeft(state.minutes);
  const clockTone = left <= 15 ? "critical" : left <= 30 ? "warn" : "normal";
  const batteryTone = state.battery === 0 ? "critical" : state.battery <= 10 ? "warn" : "normal";
  const progress = Math.round(100 * (1 - kmToAirport(state.location) / TOTAL_KM));
  const hebbal = Math.round(100 * (1 - kmToAirport("hebbal") / TOTAL_KM));

  return (
    <section aria-label="Your situation" className="sticky top-0 z-20 border-b border-line bg-night/90 backdrop-blur">
      <div className="mx-auto grid max-w-2xl grid-cols-2 gap-x-4 gap-y-3 px-4 pt-3 sm:grid-cols-4">
        <Stat label="Clock" tone={clockTone} sub={left > 0 ? `${formatDuration(left)} to check-in close` : "Check-in closed"}>
          {formatClock(state.minutes)}
        </Stat>
        <Stat label="Battery" tone={batteryTone} sub={state.battery > 0 ? "UPI and apps work" : "Dead: cash only"}>
          {state.battery}%
          <span className="ml-2 inline-block h-2 w-12 overflow-hidden rounded-sm bg-line align-middle">
            <span
              className={`block h-full ${state.battery <= 10 ? "bg-brake" : "bg-go"}`}
              style={{ width: `${state.battery}%` }}
            />
          </span>
        </Stat>
        <Stat label="Cash" tone={state.cash < 50 ? "warn" : "normal"} sub={state.quote ? `Auto asking ₹${state.quote.ask}` : "Spend it wisely"}>
          ₹{state.cash}
        </Stat>
        <Stat label="Bag" sub={state.raining ? "It's raining" : undefined}>
          <span className="block truncate text-sm sm:text-base">{bagSummary(state.inventory)}</span>
        </Stat>
      </div>

      <div className="mx-auto max-w-2xl px-4 pb-3 pt-3">
        <div className="relative h-1 rounded-full bg-line" aria-hidden>
          <div className="absolute inset-y-0 left-0 rounded-full bg-sodium transition-all duration-700" style={{ width: `${progress}%` }} />
          <div className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-muted" style={{ left: `${hebbal}%` }} />
        </div>
        <div className="relative mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted">
          <span>Silk Board</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${hebbal}%` }}>
            Hebbal
          </span>
          <span>Airport</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          <span className="text-paper">{PLACES[state.location].name}</span>
          {state.ride && (
            <>
              {" · "}in a {TRANSPORT[state.ride.transport].label} to {PLACES[state.ride.destination].short}
            </>
          )}
        </p>
      </div>
    </section>
  );
}
