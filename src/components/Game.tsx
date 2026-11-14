"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHECKIN_CLOSES } from "@/game/rules";
import type { Outcome } from "@/game/types";
import type { PublicState } from "@/game/view";
import { playTurn, startGame } from "./api";
import Backdrop from "./Backdrop";
import EndCard from "./EndCard";
import Feed, { type Entry } from "./Feed";
import Hud from "./Hud";
import { readRecord, saveResult, type PlayerRecord } from "./record";
import { mixMoves, suggest } from "./suggestions";

/** Seconds of quiet during a ride before it moves on by itself. */
const AUTO_RIDE_SECONDS = 10;

export default function Game() {
  const [state, setState] = useState<PublicState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [delta, setDelta] = useState<Outcome["delta"] | null>(null);
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  /** The ending card can be closed to read back through the evening, and reopened. */
  const [showEnd, setShowEnd] = useState(true);
  /** Moves the server worked out from the route planner for this turn. */
  const [planned, setPlanned] = useState<string[]>([]);
  /** What the move buttons showed last turn, so this turn can offer something different. */
  const [lastShown, setLastShown] = useState<string[]>([]);
  const ids = useRef(0);
  const feedEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const entry = (e: Omit<Entry, "id">): Entry => ({ ...e, id: ids.current++ });

  const begin = useCallback(async (seed?: number) => {
    setBusy(true);
    try {
      const data = await startGame(seed);
      setState(data.state);
      setToken(data.token);
      setDelta(null);
      setRecord(readRecord());
      setPlanned(data.suggestions ?? []);
      setLastShown([]);
      setEntries([{ id: ids.current++, kind: "narrator", text: data.narration, at: 0 }]);
      // A shared ?seed= link replays that evening once; after that the address is clean, so a reload
      // starts a new evening instead of replaying the same traffic. "Same evening, again" still works.
      const url = new URL(window.location.href);
      if (url.searchParams.has("seed")) {
        url.searchParams.delete("seed");
        window.history.replaceState(null, "", url);
      }
    } catch (err) {
      setEntries([{ id: ids.current++, kind: "error", text: err instanceof Error ? err.message : "Couldn't start the game." }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get("seed");
    void begin(seed && /^\d+$/.test(seed) ? Number(seed) : undefined);
  }, [begin]);

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries.length]);

  /** `auto`: sent by the ride timer. It moves one stop and shows no "you said" bubble. */
  async function send(text: string, auto = false) {
    const said = text.trim();
    if (!said || !token || !state || busy || state.status !== "playing") return;
    setBusy(true);
    setInput("");
    if (!auto) setEntries((prev) => [...prev, entry({ kind: "player", text: said })]);
    try {
      const data = await playTurn(token, said, auto);
      setLastShown(moves);
      setPlanned(data.suggestions ?? []);
      setState(data.state);
      setToken(data.token);
      setDelta(data.outcome.delta);
      if (data.state.status !== "playing") {
        setRecord(saveResult(data.state.status === "won", CHECKIN_CLOSES + (data.state.grace ?? 0) - data.state.minutes));
        setShowEnd(true);
      }
      setEntries((prev) => [...prev, entry({ kind: "narrator", text: data.narration, at: data.state.minutes, outcome: data.outcome, trace: data.trace })]);
    } catch (err) {
      setEntries((prev) => [...prev, entry({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." })]);
      if (!auto) setInput(said);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const over = state && state.status !== "playing";
  // A waiting decision shows exactly its options; otherwise mix planned moves with fresh local ideas.
  const moves = !state ? [] : state.pending ? suggest(state) : mixMoves(planned, suggest(state, 8), lastShown);

  // On a ride with nothing to decide, the city doesn't wait for you: after a quiet spell the ride moves on
  // by itself. Typing anything, or the tab being hidden, holds it (so an idle tab doesn't spend AI calls).
  const riding = Boolean(state?.ride) && !state?.pending && state?.status === "playing";
  const [autoIn, setAutoIn] = useState<number | null>(null);
  const autoRef = useRef(send);
  autoRef.current = send;
  useEffect(() => {
    if (!riding || busy || input.trim()) return;
    let left = AUTO_RIDE_SECONDS;
    const tick = setInterval(() => {
      if (document.hidden) return;
      left -= 1;
      setAutoIn(left);
      if (left <= 0) {
        clearInterval(tick);
        setAutoIn(null);
        void autoRef.current("Ride on", true);
      }
    }, 1000);
    return () => {
      clearInterval(tick);
      setAutoIn(null);
    };
  }, [riding, busy, input, state?.turn]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop raining={Boolean(state?.raining) && !over} />

      <header className="relative z-10 mx-auto flex w-full max-w-2xl items-baseline lg:max-w-5xl justify-between gap-4 px-4 pt-4">
        <h1 className="whitespace-nowrap font-mono text-sm font-semibold uppercase tracking-[0.22em] text-paper">
          <span className="font-display text-base tracking-normal text-sodium">Escape Silk Board</span>
        </h1>
        <p className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
          {record && record.played > 0
            ? `Flights caught ${record.won}/${record.played}${record.best !== null ? ` · best ${record.best} min spare` : ""}`
            : "Flight ES 940 · departs 9:40 PM"}
        </p>
      </header>
      <div aria-hidden className="hazard relative z-10 mx-auto mt-2 w-[calc(100%-2rem)] max-w-2xl lg:max-w-[62rem]" />

      {/* Wide screens: the situation stays on the left while the story scrolls on the right. */}
      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col lg:grid lg:max-w-5xl lg:grid-cols-[26rem_minmax(0,1fr)]">
      {state ? <Hud state={state} delta={delta} onMove={busy || state.status !== "playing" ? undefined : (m) => void send(m)} /> : <div />}

      <div className="flex min-w-0 flex-1 flex-col">
      <main className="w-full flex-1 px-4">
        <Feed entries={entries} busy={busy} />
        <div ref={feedEnd} />
      </main>

      <footer className="sticky bottom-0 z-10 bg-night pt-3">
        <div className="mx-auto max-w-2xl px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* Fixed-height row: the moves change every turn, the layout doesn't. */}
          <div className="mb-2 flex h-10 items-center gap-2 sm:h-9 overflow-x-auto [scrollbar-width:none]">
            {riding && autoIn !== null && !busy ? (
              <span className="shrink-0 font-mono text-[11px] text-muted" aria-live="polite">
                Riding on in {autoIn}s…
              </span>
            ) : (
              <span className="shrink-0 text-xs text-muted font-mono uppercase tracking-wider hidden sm:inline">Quick moves:</span>
            )}
            {moves.map((m) => (
              <button
                key={m}
                disabled={busy}
                onClick={() => void send(m)}
                className="shrink-0 rounded-full border border-sodium/60 bg-sodium/10 px-3.5 py-1.5 text-xs font-semibold text-sodium shadow-xs transition hover:bg-sodium hover:text-night active:scale-95 disabled:opacity-40"
              >
                {m}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex gap-2"
          >
            <label htmlFor="move" className="sr-only">
              What do you do?
            </label>
            <input
              id="move"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={280}
              autoComplete="off"
              disabled={!state || Boolean(over)}
              placeholder={over ? "The evening is over." : "Or type anything in plain English / Hinglish..."}
              className="min-w-0 flex-1 rounded-xl bg-panel px-4 py-3 font-mono text-base text-paper ring-1 sm:text-sm ring-white/10 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-sodium disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || Boolean(over)}
              className="rounded-xl bg-sodium px-5 font-bold text-night shadow-md hover:brightness-110 active:scale-95 disabled:opacity-40"
            >
              Go
            </button>
          </form>
        </div>
      </footer>
      </div>
      </div>

      {state && over && showEnd && (
        <EndCard state={state} record={record} onNew={() => void begin()} onReplay={() => void begin(state.seed)} onClose={() => setShowEnd(false)} />
      )}
      {state && over && !showEnd && (
        <button
          type="button"
          onClick={() => setShowEnd(true)}
          className="animate-rise fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-full bg-sodium px-5 py-2.5 font-bold text-night shadow-lg ring-2 ring-night hover:brightness-110"
        >
          {state.status === "won" ? "🎫 See your boarding pass" : "🧾 See your receipt"}
        </button>
      )}
    </div>
  );
}
