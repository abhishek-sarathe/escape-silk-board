import { useEffect, useState } from "react";
import { formatClock } from "@/game/clock";
import { PLACES } from "@/game/map";
import { CHECKIN_CLOSES } from "@/game/rules";
import type { PublicState } from "@/game/view";
import { BengaluruMap } from "./BengaluruMap";
import type { PlayerRecord } from "./record";

const TRIP_ICON: Record<string, string> = {
  walk: "🚶",
  auto: "🛺",
  cab: "🚕",
  bike_taxi: "🛵",
  bus: "🚌",
  ac_bus: "🚌",
  airport_bus: "🚍",
  lift: "🚗",
};

/** The route as one shareable line: "🛵 Silk Board → Hebbal · 🚌 281-AP → Airport". */
function tripLine(s: PublicState): string {
  const legs = s.journey ?? [];
  const parts: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const prev = legs[i - 1];
    if (prev && prev.mode === l.mode && prev.line === l.line) {
      parts[parts.length - 1] = parts[parts.length - 1].replace(/ → [^·]+$/, ` → ${PLACES[l.to].short}`);
    } else {
      parts.push(`${TRIP_ICON[l.mode] ?? "•"} ${l.line ? `${l.line} ` : ""}${PLACES[l.from].short} → ${PLACES[l.to].short}`);
    }
  }
  return parts.length ? parts.join(" · ") : "🚦 Never left Silk Board";
}

/** What became of the one cold samosa you started with. */
function samosaFate(s: PublicState): string {
  if (s.inventory.includes("samosa")) return "Still in your bag. Cold. Undefeated. 🫡";
  if (s.flags.includes("traded:samosa")) return "Traded to an auto anna. A legend now rides with him. 🛺";
  if (s.flags.includes("used:samosa")) return "Eaten (or gifted). It gave its all. 🫡";
  return "Lost to the traffic gods. 🙏";
}

/**
 * The ending replaces the game: a Kempegowda T2 boarding pass if you made it, a Peak Bengaluru
 * Traffic Award receipt if you didn't. The input bar is locked behind it (see Game.tsx).
 */
export default function EndCard({
  state,
  record,
  onNew,
  onReplay,
  onClose,
}: {
  state: PublicState;
  record: PlayerRecord | null;
  onNew: () => void;
  onReplay: () => void;
  /** Hide the card to read back through the evening; Game shows a button to bring it back. */
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const won = state.status === "won";
  const gap = Math.abs(CHECKIN_CLOSES + (state.grace ?? 0) - state.minutes);
  const gaveUp = !won && state.minutes <= CHECKIN_CLOSES + (state.grace ?? 0) && !state.endReason?.startsWith("Stranded");
  const newBest = won && record?.best === gap;
  const routeText = state.visited.map((id) => PLACES[id].short).join(" → ");

  async function share() {
    const line = won
      ? `🎉 I escaped Silk Board and caught flight ES 940 with ${gap} minutes to spare!`
      : gaveUp
        ? "😅 Silk Board broke my spirit and I went home."
        : `🚦 I missed my flight at Silk Board by ${gap} minutes!`;
    const text = `${line}\n${tripLine(state)}\nEvening #${state.seed} in Bengaluru. Can you beat the traffic? Play here: ${window.location.origin}/?seed=${state.seed}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:items-center">
      {won && (
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
          {["🎉", "✈️", "🛺", "⭐", "✨", "🎊", "☕"].map((char, i) => (
            <span
              key={i}
              className="absolute animate-bounce text-2xl opacity-75"
              style={{ top: `${15 + ((i * 12) % 70)}%`, left: `${8 + ((i * 14) % 84)}%`, animationDuration: `${1.5 + (i % 3) * 0.5}s` }}
            >
              {char}
            </span>
          ))}
        </div>
      )}

      <div role="dialog" aria-modal="true" aria-labelledby="end-title" className="animate-rise relative my-auto w-full max-w-lg">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close and read back through the evening"
          title="Close (Esc)"
          className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-panel text-lg font-bold text-paper shadow-lg ring-1 ring-white/20 transition hover:bg-line"
        >
          ✕
        </button>
        {/* The ending is the map: the whole evening, every stretch and every thing that happened. */}
        <div className="mb-3">
          <BengaluruMap state={state} variant="ending" />
        </div>
        {won ? <BoardingPass state={state} gap={gap} route={routeText} /> : <TrafficAward state={state} gap={gap} gaveUp={gaveUp} route={routeText} />}

        {record && record.played > 0 && (
          <p className="mt-3 text-center font-mono text-xs font-medium text-paper/90">
            {newBest && <span className="font-bold text-metro-green">✨ New personal best! </span>}
            Flights caught: <span className="font-bold text-sodium">{record.won}</span> of {record.played}
            {record.best !== null && ` (best: ${record.best} min to spare)`}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          <button
            autoFocus
            onClick={onNew}
            className="flex items-center justify-center gap-2 rounded-xl bg-sodium px-5 py-4 font-display text-lg text-night shadow-lg transition hover:brightness-110 active:scale-[0.98]"
          >
            🛺 Play Again (New Route)
          </button>
          <div className="flex gap-2">
            <button
              onClick={onReplay}
              className="flex-1 rounded-xl border border-white/10 bg-panel px-4 py-2.5 text-sm font-semibold text-paper transition hover:bg-line active:scale-[0.98]"
            >
              {won ? "⚡ Same evening, faster" : "🔁 Retry this evening"}
            </button>
            <button
              onClick={() => void share()}
              className="flex-1 rounded-xl border border-sodium/50 bg-sodium/10 px-4 py-2.5 text-sm font-bold text-sodium transition hover:bg-sodium/20 active:scale-[0.98]"
            >
              {copied ? "✅ Copied!" : "📢 Challenge friends"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, wide = false }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={`rounded-lg bg-white/80 p-2 ring-1 ring-zinc-200/70 ${wide ? "col-span-3" : ""}`}>
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{k}</dt>
      <dd className={`mt-0.5 font-mono text-xs font-bold text-zinc-900 sm:text-sm ${wide ? "leading-snug" : "truncate"}`}>{v}</dd>
    </div>
  );
}

function BoardingPass({ state, gap, route }: { state: PublicState; gap: number; route: string }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-[#faf8f5] text-night shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center justify-between bg-[#1f9d55] px-6 py-3.5 text-xs font-bold uppercase tracking-widest text-white">
        <span>✈️ Kempegowda Intl · Terminal 2</span>
        <span className="font-mono text-[11px] opacity-90">Evening #{state.seed}</span>
      </div>

      <div className="relative p-6 sm:p-7">
        <div className="animate-stamp absolute right-5 top-5 rounded-xl border-4 border-emerald-600 bg-emerald-50/90 px-3 py-1 font-display text-lg uppercase text-emerald-700 select-none sm:text-xl">
          ✓ Boarded
        </div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-500">🏆 Bengaluru speedrun</p>
        <h2 id="end-title" className="mt-1 max-w-[65%] font-display text-2xl text-night sm:text-3xl">
          {gap} min to spare!
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-zinc-700 sm:text-base">
          {state.endReason ?? "You made it through the gates before the final call!"} Machaa, you beat Silk Board. Tell everyone.
        </p>
      </div>

      <div className="relative border-t-2 border-dashed border-zinc-300">
        <span className="absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full bg-night" />
        <span className="absolute -right-3.5 -top-3.5 h-7 w-7 rounded-full bg-night" />
      </div>

      <dl className="grid grid-cols-3 gap-2.5 bg-zinc-50/70 p-5 sm:p-6">
        <Field k="Flight" v="ES 940" />
        <Field k="Check-in" v={formatClock(state.minutes)} />
        <Field k="Seat" v="14A window" />
        <Field k="Money left" v={`₹${state.cash} cash · ₹${state.upi ?? 0} UPI`} />
        <Field k="Battery" v={`${state.battery}%`} />
        <Field k="Moves" v={`${state.turn}`} />
        <Field k="Your route" v={`${route} ✈️`} wide />
        <Field k="Samosa fate" v={samosaFate(state)} wide />
      </dl>

      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-100/80 px-6 py-2.5 font-mono text-[10px] text-zinc-400">
        <span aria-hidden className="tracking-[0.3em]">||| | ||||| || | |||| ||| |||| |</span>
        <span>BLR-ES940-T2</span>
      </div>
    </div>
  );
}

function TrafficAward({ state, gap, gaveUp, route }: { state: PublicState; gap: number; gaveUp: boolean; route: string }) {
  const lines: [string, string][] = [
    ["Flight ES 940", gaveUp ? "Abandoned" : `Missed by ${gap} min`],
    ["Last seen at", PLACES[state.location].short],
    ["Clock", formatClock(state.minutes)],
    ["Money left", `₹${state.cash} cash · ₹${state.upi ?? 0} UPI`],
    ["Battery left", `${state.battery}%`],
    ["Moves made", `${state.turn}`],
  ];
  return (
    <div className="overflow-hidden rounded-2xl bg-[#fffdf5] text-night shadow-2xl">
      <div className="hazard" aria-hidden />
      <div className="relative px-6 pb-4 pt-5 text-center">
        <div className="text-4xl" aria-hidden>
          🏆
        </div>
        <p className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Missed flight receipt</p>
        <h2 id="end-title" className="mt-1 font-display text-2xl text-night sm:text-3xl">
          Peak Bengaluru Traffic Award
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-700">
          {state.endReason ?? "The traffic won this round."} Scene illa, machaa. Silk Board has humbled better people. It&apos;ll make a great story.
        </p>
        <div className="animate-stamp absolute right-4 top-4 rounded-lg border-4 border-[#7b2d8e] px-2 py-0.5 font-display text-sm uppercase text-[#7b2d8e] select-none">
          {gaveUp ? "Went home" : "Missed"}
        </div>
      </div>

      <div className="border-t-2 border-dashed border-zinc-300 px-6 py-4 font-mono text-xs sm:text-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-0.5">
            <span className="text-zinc-500">{k}</span>
            <span className="font-bold text-zinc-900">{v}</span>
          </div>
        ))}
        <div className="mt-3 border-t border-zinc-200 pt-3">
          <div className="text-zinc-500">Your route</div>
          <div className="font-bold leading-snug text-zinc-900">{route}</div>
        </div>
        <div className="mt-3">
          <div className="text-zinc-500">Samosa fate</div>
          <div className="font-bold leading-snug text-zinc-900">{samosaFate(state)}</div>
        </div>
        {/* True at the time of writing: the Blue Line (Silk Board to the airport) is due in stages from mid-2027. */}
        <div className="mt-3 rounded-md bg-sky-50 px-3 py-2 font-sans text-xs leading-snug text-sky-900 ring-1 ring-sky-200">
          <span className="font-bold">P.S.</span> Maybe next year 😁 The Blue Line metro will run from right here at Silk Board to the
          airport. The first stretch, to KR Puram, is due around mid-2027. The airport bit, after that. Probably.
        </div>
      </div>

      <div className="border-t-2 border-dashed border-zinc-300 bg-amber-50 px-6 py-2.5 text-center font-mono text-[10px] uppercase tracking-widest text-zinc-500">
        Evening #{state.seed} · Thank you, visit again 🙏
      </div>
      <div className="hazard" aria-hidden />
    </div>
  );
}
