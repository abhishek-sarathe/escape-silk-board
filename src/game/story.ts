// The evening so far, as a short briefing for the AI: where you've been and how, what the city threw at
// you and where, and the last few exchanges. Lets the player refer back ("that bus that broke down",
// "the driver from before") and lets the narrator call back to earlier moments. Built from engine state
// only, so it can't drift from what really happened.
import { formatClock } from "./clock";
import { PLACES } from "./map";
import { TRANSPORT } from "./rules";
import type { GameState } from "./types";

const short = (id: keyof typeof PLACES) => PLACES[id].short;

export function eveningSoFar(s: GameState, exchanges = 4): string {
  const lines: string[] = [];

  const legs = s.journey ?? [];
  if (legs.length) {
    const route = legs.map((l) => {
      const how = l.mode === "walk" ? "on foot" : `${l.line ? `${l.line} ` : ""}${TRANSPORT[l.mode].label}`;
      return `${short(l.to)} (${how}${l.at !== undefined ? `, ${formatClock(l.at)}` : ""})`;
    });
    lines.push(`Route so far: ${short(legs[0].from)} → ${route.join(" → ")}`);
  } else {
    lines.push("Route so far: still at Silk Board.");
  }

  for (const m of s.marks ?? []) lines.push(`${formatClock(m.minutes)} at ${short(m.place)}: ${m.text}`);

  const recent = s.history.slice(-exchanges);
  if (recent.length) {
    lines.push("Last exchanges:");
    for (const h of recent) lines.push(`- Player: ${h.input}\n  Narrator: ${h.narration}`);
  }
  return lines.join("\n");
}
