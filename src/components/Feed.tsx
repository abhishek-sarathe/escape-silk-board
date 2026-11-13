import { useEffect, useState } from "react";
import { formatClock } from "@/game/clock";
import { PLACES } from "@/game/map";
import { ITEMS } from "@/game/rules";
import type { Outcome } from "@/game/types";

export interface Entry {
  id: number;
  kind: "narrator" | "player" | "error";
  text: string;
  /** Game minutes when this line happened. */
  at?: number;
  outcome?: Outcome;
  /** The Game Master agent's tool calls for this turn. */
  trace?: TraceStep[];
}

export interface TraceStep {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

const TOOL_LABEL: Record<string, string> = {
  look_around: "👀 looked around",
  bus_options: "🚌 checked buses",
  quote: "💸 got a quote",
  take_action: "✅ committed",
  fallback: "↩️ fell back",
};

/** The agent's working, step by step: what it looked up and the one action it committed. */
function Trace({ steps }: { steps: TraceStep[] }) {
  const args = (a: Record<string, unknown>) =>
    Object.entries(a)
      .filter(([, v]) => v !== null && v !== false && !(Array.isArray(v) && !v.length) && v !== "")
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : String(v)}`)
      .join(" ");
  return (
    <details className="mt-3 rounded-md bg-night/60 px-3 py-2 text-[12px] ring-1 ring-white/5">
      <summary className="cursor-pointer select-none font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        How Anna decided · {steps.length} step{steps.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-2 space-y-1.5 font-mono">
        {steps.map((s, i) => (
          <li key={i} className="min-w-0">
            <span className="text-sodium">{TOOL_LABEL[s.tool] ?? s.tool}</span>
            {args(s.args) && <span className="text-paper"> {args(s.args)}</span>}
            {s.tool !== "take_action" && <div className="truncate text-muted">{s.result}</div>}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Types the newest narration out. The untyped remainder is rendered invisibly,
 * so the paragraph already has its final height and nothing below it moves.
 */
function Typed({ text, animate }: { text: string; animate: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const step = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? text.length : 3;
    const id = setInterval(() => setN((v) => Math.min(text.length, v + step)), 16);
    return () => clearInterval(id);
  }, [animate, text]);

  if (!animate || n >= text.length) return <>{text}</>;
  return (
    <>
      <span aria-hidden>{text.slice(0, n)}</span>
      <span aria-hidden className="opacity-0">
        {text.slice(n)}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

function signed(n: number, unit: string, prefix = "") {
  return `${n > 0 ? "+" : "−"}${prefix}${Math.abs(n)}${unit}`;
}

function Changes({ outcome }: { outcome: Outcome }) {
  const d = outcome.delta;
  const chips: { text: string; tone: string }[] = [{ text: `+${d.minutes} min`, tone: "text-sodium" }];
  if (d.cash) chips.push({ text: signed(d.cash, "", "₹"), tone: d.cash < 0 ? "text-brake" : "text-go" });
  if (d.battery) chips.push({ text: signed(d.battery, "% battery"), tone: d.battery < 0 ? "text-muted" : "text-go" });
  if (d.from !== d.to) chips.push({ text: `→ ${PLACES[d.to].short}`, tone: "text-paper" });
  d.itemsGained.forEach((i) => chips.push({ text: `+ ${ITEMS[i].label}`, tone: "text-go" }));
  d.itemsLost.forEach((i) => chips.push({ text: `− ${ITEMS[i].label}`, tone: "text-muted" }));

  return (
    <div className="mt-3 space-y-2">
      {outcome.event && (
        <div className="rounded-md border-2 border-sodium px-3 py-2.5">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-sodium">
            {outcome.event.id.startsWith("decision:") ? "🤔 Your call" : "Meanwhile, in the city"}
          </div>
          <p className="mt-0.5 text-sm text-paper">{outcome.event.text}</p>
        </div>
      )}
      <ul className="flex flex-wrap gap-1.5 font-mono text-[11px]" aria-label="What changed">
        {chips.map((c, i) => (
          <li key={`${i}-${c.text}`} className={`rounded bg-panel px-2 py-0.5 ${c.tone}`}>
            {c.text}
          </li>
        ))}
      </ul>
      {outcome.refused.length > 0 && (
        <ul className="space-y-0.5 text-[12px] text-muted" aria-label="Not allowed">
          {outcome.refused.map((r) => (
            <li key={r}>
              <span className="mr-1 font-mono text-brake">✕</span>
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Feed({ entries, busy }: { entries: Entry[]; busy: boolean }) {
  const lastId = entries[entries.length - 1]?.id;
  return (
    <ol className="space-y-6 py-6" aria-live="polite">
      {entries.map((e) => {
        if (e.kind === "player") {
          return (
            <li key={e.id} className="animate-rise flex flex-col items-end">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted">
                <span>YOU</span>
                <span>💬</span>
              </div>
              <p className="max-w-[85%] rounded-2xl rounded-tr-xs bg-sodium px-4 py-2.5 text-sm font-bold text-night shadow-sm">
                {e.text}
              </p>
            </li>
          );
        }
        if (e.kind === "error") {
          return (
            <li key={e.id} className="animate-rise rounded-lg border border-brake/40 bg-brake/10 p-3 text-sm text-brake">
              <span className="font-bold mr-1">⚠️</span> {e.text}
            </li>
          );
        }
        return (
          <li key={e.id} className="animate-rise rounded-xl bg-panel/40 p-4 ring-1 ring-white/5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-sodium">
                <span>🎙️</span>
                <span>NARRATOR</span>
              </span>
              {e.at !== undefined && (
                <span className="font-mono text-[11px] font-semibold text-muted bg-line/60 rounded px-2 py-0.5">
                  {formatClock(e.at)}
                </span>
              )}
            </div>
            <p className="text-[16px] leading-relaxed text-paper">
              <Typed text={e.text} animate={e.id === lastId} />
            </p>
            {e.outcome && <Changes outcome={e.outcome} />}
            {e.trace && e.trace.length > 0 && <Trace steps={e.trace} />}
          </li>
        );
      })}
      {/* Always rendered, so the feed's height doesn't jump when a reply starts or lands. */}
      <li
        aria-hidden={!busy}
        className={`flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-sodium ${
          busy ? "animate-pulse-soft" : "invisible"
        }`}
      >
        <span>🛺</span>
        <span>The city is answering…</span>
      </li>
    </ol>
  );
}
