"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState } from "@/game/view";
import { playTurn, startGame } from "./api";
import EndCard from "./EndCard";
import Feed, { type Entry } from "./Feed";
import Hud from "./Hud";

const OPENERS = ["bhaiya, airport chaloge? meter se.", "Check bike taxi prices to Hebbal", "Buy a chai and think about my life"];

export default function Game() {
  const [state, setState] = useState<PublicState | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(true);
  const [via, setVia] = useState<string | null>(null);
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
      setVia(null);
      setEntries([{ id: ids.current++, kind: "narrator", text: data.narration, at: 0 }]);
      const url = new URL(window.location.href);
      url.searchParams.set("seed", String(data.state.seed));
      window.history.replaceState(null, "", url);
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
  }, [entries.length, busy]);

  async function send(text: string) {
    const said = text.trim();
    if (!said || !token || !state || busy || state.status !== "playing") return;
    setBusy(true);
    setInput("");
    setEntries((prev) => [...prev, entry({ kind: "player", text: said })]);
    try {
      const data = await playTurn(token, said);
      setState(data.state);
      setToken(data.token);
      setVia(data.via.narrator);
      setEntries((prev) => [...prev, entry({ kind: "narrator", text: data.narration, at: data.state.minutes, outcome: data.outcome })]);
    } catch (err) {
      setEntries((prev) => [...prev, entry({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." })]);
      setInput(said);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const over = state && state.status !== "playing";
  const tokens = state ? state.usage.promptTokens + state.usage.completionTokens : 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between gap-4 px-4 py-3">
          <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.22em] text-paper">Escape Silk Board</h1>
          <p className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            ES 940 · BLR · Dep 9:40 PM · Check-in closes 8:55
          </p>
        </div>
      </header>

      {state && <Hud state={state} />}

      <main className="mx-auto w-full max-w-2xl flex-1 px-4">
        <Feed entries={entries} busy={busy} />
        <div ref={feedEnd} />
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-line bg-night/95 backdrop-blur">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {state?.turn === 0 && !busy && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {OPENERS.map((o) => (
                <button
                  key={o}
                  onClick={() => void send(o)}
                  className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-sodium hover:text-sodium"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
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
              placeholder={over ? "The evening is over." : "What do you do?"}
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm text-paper placeholder:text-muted focus:border-sodium focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || Boolean(over)}
              className="rounded-lg bg-sodium px-4 font-medium text-night hover:brightness-110 disabled:opacity-40"
            >
              Go
            </button>
          </form>
          {state && (
            <p className="mt-2 truncate font-mono text-[10px] text-muted">
              Evening #{state.seed}
              {via && ` · narrated by ${via}`}
              {tokens > 0 && ` · ${(tokens / 1000).toFixed(1)}k tokens`}
              {state.usage.costUsd > 0 && ` · $${state.usage.costUsd.toFixed(4)}`}
            </p>
          )}
        </div>
      </footer>

      {state && over && <EndCard state={state} onNew={() => void begin()} onReplay={() => void begin(state.seed)} />}
    </div>
  );
}
