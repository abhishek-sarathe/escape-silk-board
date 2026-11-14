// Keyword parser used when every LLM provider is down (or no key is set).
// Cruder than the LLM, but the game never stops working.
import { normaliseLine } from "@/game/buses";
import { askedForGone } from "@/game/gone";
import { findPlace } from "@/game/map";
import type { Action, GameState, ItemId } from "@/game/types";

const ITEM_WORDS: Record<ItemId, string[]> = {
  samosa: ["samosa"],
  chai: ["chai", "tea"],
  coffee: ["coffee", "kaapi"],
  water: ["water"],
  umbrella: ["umbrella"],
};

export function blankAction(note = ""): Action {
  return {
    kind: "other",
    transport: null,
    destination: null,
    line: null,
    choice: null,
    offer: null,
    offerMeter: false,
    acceptAsk: false,
    priceCheck: false,
    items: [],
    minutes: null,
    who: null,
    note,
  };
}

export function parseLocally(state: GameState, input: string): Action {
  const t = input.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(t);
  const base = blankAction(
    input
      .trim()
      .replace(/^i\s+(?:will\s+|want to\s+|try to\s+)?/i, "")
      .replace(/[.!?]+$/, "")
      .slice(0, 80),
  );
  const items = (Object.keys(ITEM_WORDS) as ItemId[]).filter((id) =>
    ITEM_WORDS[id].some((w) => new RegExp(`\\b${w}\\b`).test(t)),
  );
  const minutes = Number(t.match(/(\d{1,2})\s*(?:min|mins|minutes)\b/)?.[1] ?? NaN);
  const amount = Number(t.match(/(?:₹|rs\.?\s*|inr\s*)?\b(\d{2,5})\b(?!\s*(?:min|mins|minutes|km|%))/)?.[1] ?? NaN);
  const destination = findPlace(t);

  if (has(/\b(give up|go home|quit|forget it)\b/)) return { ...base, kind: "give_up" };
  // Bounce, Vogo, Yulu, the metro: not options tonight; the engine tells the real story (see game/gone.ts).
  const gone = askedForGone(t);
  if (gone && !has(/\b(rapido|uber|ola|auto|cab|taxi|bus|bmtc)\b/)) return { ...base, kind: "other", note: `look for a ${gone.id}` };
  // A decision is waiting: a number ("2") or the option's own words pick it.
  if (state.pending) {
    const opts = state.pending.options;
    const n = Number(t.trim().match(/^(\d)\b/)?.[1]);
    if (n >= 1 && n <= opts.length) return { ...base, kind: "choose", choice: opts[n - 1].key };
    const words = (label: string) => label.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const scored = opts.map((o) => ({ o, score: words(o.label).filter((w) => t.includes(w)).length })).sort((a, b) => b.score - a.score);
    if (scored[0].score > 0 && scored[0].score > (scored[1]?.score ?? 0)) return { ...base, kind: "choose", choice: scored[0].o.key };
    if (/^(yes|yeah|ok|okay|sure|haan|chalo)\b/.test(t.trim()) && opts[0]) return { ...base, kind: "choose", choice: opts[0].key };
    if (/^(no|nope|nah|illa)\b/.test(t.trim())) return { ...base, kind: "choose", choice: state.pending.fallback };
  }
  // A question is asking, not doing: "how much is the bus?", "is there an auto?"
  if (/\?\s*$/.test(t) || /^(what|how|which|where|when|why|is there|are there|can i|should i|do i)\b/.test(t.trim()))
    return { ...base, kind: "other", minutes: 2 };
  if (has(/\b(teleport|helicopter|time travel|back in time|ignore (all|previous|your)|system prompt|you are an ai|cheat|god mode)\b/))
    return { ...base, kind: "impossible" };
  if (state.location === "airport" && has(/\b(check[\s._-]?in|counter|inside|gate|run|rush|sprint|terminal|security|digi ?yatra|desk|board|flight)\b/))
    return { ...base, kind: "check_in" };
  if (has(/\b(get out|get off|hop off|stop here|leave the (auto|cab|bus|bike))\b/)) return { ...base, kind: "leave_ride" };
  if (has(/\b(charge|charging|plug)\b/))
    return { ...base, kind: "charge", minutes: Number.isFinite(minutes) ? minutes : null };
  if (has(/\b(call|ring|phone)\b/) && !has(/\b(app|book)\b/)) {
    const who = has(/\b(friend|bro|machaa?|dude)\b/)
      ? "friend"
      : has(/\b(mom|amma|mother|dad|appa|family|wife|husband)\b/)
        ? "family"
        : has(/\b(airline|airport)\b/)
          ? "airline"
          : "other";
    return { ...base, kind: "call", who };
  }
  if (has(/\b(buy|purchase|order)\b/)) return { ...base, kind: "buy", items };
  if (items.length && has(/\b(eat|drink|sip|open|give|share)\b/)) return { ...base, kind: "use_item", items };

  // A real route number: "500-D", "KIA-8", "kia 8", "V-500D", "281-AP", "G-9".
  const lineMatch = t.match(/\b(kia[- ]?\d{1,2}[a-z]{0,2}|v-?\d{3}[a-z]{0,2}|\d{3}-[a-z]{1,3}|[a-z]{1,3}-\d{1,3}[a-z]?)\b/);
  const line = lineMatch ? normaliseLine(lineMatch[1]) : null;
  const transport = line
    ? line.startsWith("KIA")
      ? "airport_bus"
      : line.startsWith("V-")
        ? "ac_bus"
        : "bus"
    : has(/\b(vayu|kia|airport bus)\b/)
      ? "airport_bus"
      : has(/\b(ac bus|a\/c bus|vajra|volvo)\b/)
        ? "ac_bus"
        : has(/\b(bus|bmtc)\b/)
          ? "bus"
          : has(/\b(bike|rapido|two ?wheeler)\b/)
      ? "bike_taxi"
      : has(/\b(cab|uber|ola|taxi)\b/)
        ? "cab"
        : has(/\b(auto|rickshaw|bhaiya|anna|meter|chaloge)\b/)
          ? "auto"
          : null;
  const agrees = has(/\b(ok|okay|fine|deal|done|agree|chalo|haan|yes)\b/);
  const haggling = state.quote && (Number.isFinite(amount) || agrees || has(/\b(offer|meter)\b/));
  if (transport || haggling) {
    return {
      ...base,
      kind: "hire",
      transport: transport ?? "auto",
      line,
      // A named bus route with no place means "as far as it goes"; the engine works that out.
      destination: destination ?? (line ? null : (state.quote?.destination ?? "airport")),
      offer: Number.isFinite(amount) ? amount : null,
      offerMeter: has(/\bmeter\b/),
      acceptAsk: agrees && !Number.isFinite(amount),
      priceCheck: has(/\b(check|how much|prices?|fares?|cost|kitna)\b/) && !has(/\b(book|take|hire|get in)\b/),
      items,
    };
  }
  if (has(/\b(walk|on foot|run|jog)\b/)) return { ...base, kind: "walk", destination };
  if (has(/\b(continue|keep going|go on|drive|faster|hurry)\b/)) return { ...base, kind: "continue" };
  if (has(/\b(wait|sit|relax|sleep|nap)\b/))
    return { ...base, kind: "wait", minutes: Number.isFinite(minutes) ? minutes : null };
  return base;
}
