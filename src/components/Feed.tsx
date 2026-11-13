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
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-sodium">Meanwhile, in the city</div>
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
            <li key={e.id} className="animate-rise flex justify-end">
              <p className="max-w-[85%] rounded-md bg-sodium px-3.5 py-2 text-sm font-semibold text-night">{e.text}</p>
            </li>
          );
        }
        if (e.kind === "error") {
          return (
            <li key={e.id} className="animate-rise text-sm text-brake">
              {e.text}
            </li>
          );
        }
        return (
          <li key={e.id} className="animate-rise">
            {e.at !== undefined && (
              <div className="mb-1 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{formatClock(e.at)}</div>
            )}
            <p className="text-[17px] leading-relaxed text-paper">
              <Typed text={e.text} animate={e.id === lastId} />
            </p>
            {e.outcome && <Changes outcome={e.outcome} />}
          </li>
        );
      })}
      {/* Always rendered, so the feed's height doesn't jump when a reply starts or lands. */}
      <li
        aria-hidden={!busy}
        className={`font-mono text-xs uppercase tracking-[0.18em] text-muted ${busy ? "animate-pulse-soft" : "invisible"}`}
      >
        The city is thinking…
      </li>
    </ol>
  );
}
