import { formatClock } from "@/game/clock";
import { PLACES } from "@/game/map";
import type { PublicState } from "@/game/view";

export default function EndCard({ state, onNew, onReplay }: {
  state: PublicState;
  onNew: () => void;
  onReplay: () => void;
}) {
  const won = state.status === "won";
  const stats = [
    ["Time", formatClock(state.minutes)],
    ["Last seen", PLACES[state.location].short],
    ["Cash left", `₹${state.cash}`],
    ["Battery", `${state.battery}%`],
    ["Turns", String(state.turn)],
  ];

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-night/70 p-4 backdrop-blur-sm sm:items-center">
      <div role="dialog" aria-labelledby="end-title" className="animate-rise w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-2xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Flight ES 940 · BLR</p>
        <h2 id="end-title" className={`mt-1 font-mono text-4xl font-semibold tracking-tight ${won ? "text-go" : "text-brake"}`}>
          {won ? "BOARDING" : "MISSED"}
        </h2>
        <p className="mt-3 text-paper">{state.endReason}</p>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-dashed border-line pt-4">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">{k}</dt>
              <dd className="font-mono tabular-nums text-paper">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button onClick={onNew} className="flex-1 rounded-lg bg-sodium px-4 py-2.5 font-medium text-night hover:brightness-110">
            New evening
          </button>
          <button onClick={onReplay} className="flex-1 rounded-lg border border-line px-4 py-2.5 text-paper hover:bg-line/50">
            Same evening, again
          </button>
        </div>
      </div>
    </div>
  );
}
