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
        <p className="border-l-2 border-sodium pl-3 text-sm text-sodium">{outcome.event.text}</p>
      )}
      <ul className="flex flex-wrap gap-1.5 font-mono text-[11px]" aria-label="What changed">
        {chips.map((c, i) => (
          <li key={`${i}-${c.text}`} className={`rounded border border-line bg-panel px-1.5 py-0.5 ${c.tone}`}>
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
  return (
    <ol className="space-y-6 py-6" aria-live="polite">
      {entries.map((e) => {
        if (e.kind === "player") {
          return (
            <li key={e.id} className="animate-rise flex justify-end">
              <p className="max-w-[85%] rounded-lg border border-line bg-panel px-3 py-2 font-mono text-sm text-sodium">
                <span className="text-muted">› </span>
                {e.text}
              </p>
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
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{formatClock(e.at)}</div>
            )}
            <p className="text-[17px] leading-relaxed text-paper">{e.text}</p>
            {e.outcome && <Changes outcome={e.outcome} />}
          </li>
        );
      })}
      {busy && (
        <li className="animate-pulse-soft font-mono text-xs uppercase tracking-[0.18em] text-muted">The city is thinking…</li>
      )}
    </ol>
  );
}
