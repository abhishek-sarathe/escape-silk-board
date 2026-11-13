import { useState } from "react";
import { formatClock } from "@/game/clock";
import { PLACES } from "@/game/map";
import { CHECKIN_CLOSES } from "@/game/rules";
import type { PublicState } from "@/game/view";
import type { PlayerRecord } from "./record";

/** The ending as a boarding pass: stamped BOARDED if you made it, MISSED if you didn't. */
export default function EndCard({ state, record, onNew, onReplay }: {
  state: PublicState;
  record: PlayerRecord | null;
  onNew: () => void;
  onReplay: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const won = state.status === "won";
  const gap = Math.abs(CHECKIN_CLOSES - state.minutes);
  const gaveUp = !won && state.minutes <= CHECKIN_CLOSES;
  const headline = won ? `${gap} min to spare` : gaveUp ? "You went home" : `Missed by ${gap} min`;
  const newBest = won && record?.best === gap;

  const fields = [
    ["From", "Silk Board"],
    ["To", "BLR · ES 940"],
    [won ? "At counter" : "Last seen", won ? formatClock(state.minutes) : PLACES[state.location].short],
    ["Cash left", `₹${state.cash}`],
    ["Battery", `${state.battery}%`],
    ["Moves", String(state.turn)],
  ];

  async function share() {
    const line = won
      ? `I made my flight with ${gap} minutes to spare.`
      : gaveUp
        ? "I gave up on my flight at Silk Board."
        : `I missed my flight by ${gap} minutes.`;
    const text = `${line} Escape Silk Board, evening #${state.seed}. Same city, same traffic: can you do better? ${window.location.origin}/?seed=${state.seed}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center overflow-y-auto bg-night/80 p-4 backdrop-blur-sm sm:items-center">
      <div role="dialog" aria-labelledby="end-title" className="animate-rise w-full max-w-md">
        <div className="relative overflow-hidden rounded-2xl bg-paper text-night shadow-2xl">
          <div className={`px-6 py-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-night ${won ? "bg-go" : "bg-brake"}`}>
            Boarding pass · Evening #{state.seed}
          </div>
          <div className="relative px-6 pb-5 pt-4">
            <span
              className={`animate-stamp absolute right-4 top-3 rounded-md border-4 px-2 py-0.5 font-display text-xl uppercase ${won ? "border-go text-go" : "border-brake text-brake"}`}
              style={{ filter: "saturate(0.8) brightness(0.8)" }}
            >
              {won ? "Boarded" : "Missed"}
            </span>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-night/60">{won ? "You made it" : "Cause of missed flight"}</p>
            <h2 id="end-title" className="mt-1 max-w-[70%] font-display text-3xl leading-tight">
              {headline}
            </h2>
            <p className="mt-2 text-sm text-night/80">{state.endReason}</p>
          </div>
          {/* The tear line, with a notch punched out of each edge. */}
          <div className="relative border-t-2 border-dashed border-night/25">
            <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-night" />
            <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-night" />
          </div>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-3 px-6 py-4">
            {fields.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="font-mono text-[9px] uppercase tracking-[0.18em] text-night/55">{k}</dt>
                <dd className="truncate font-mono text-sm font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {record && record.played > 0 && (
          <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
            {newBest && <span className="text-go">New personal best · </span>}
            Flights caught: {record.won} of {record.played}
            {record.best !== null && ` · best ${record.best} min to spare`}
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {/* After a loss the same evening is the default: you know the traffic now. */}
          <button
            onClick={won ? onNew : onReplay}
            className="rounded-xl bg-sodium px-4 py-3 font-semibold text-night hover:brightness-110"
          >
            {won ? "Play a new evening" : "Try this evening again"}
          </button>
          <div className="flex gap-2">
            <button onClick={won ? onReplay : onNew} className="flex-1 rounded-xl bg-panel px-4 py-2.5 text-sm text-paper hover:bg-line">
              {won ? "Same evening, faster" : "New evening"}
            </button>
            <button onClick={() => void share()} className="flex-1 rounded-xl bg-panel px-4 py-2.5 text-sm text-paper hover:bg-line">
              {copied ? "Copied. Send it." : "Challenge a friend"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
