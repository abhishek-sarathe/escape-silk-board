// Keyword parser used when every LLM provider is down (or no key is set).
// Cruder than the LLM, but the game never stops working.
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
    offer: null,
    offerMeter: false,
    acceptAsk: false,
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
  if (has(/\b(teleport|helicopter|time travel|back in time|ignore (all|previous|your)|system prompt|you are an ai|cheat|god mode)\b/))
    return { ...base, kind: "impossible" };
  if (state.location === "airport" && has(/\b(check ?-?in|counter|inside|gate|run|terminal)\b/)) return { ...base, kind: "check_in" };
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

  const transport = has(/\b(bus|bmtc|vayu)\b/)
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
      destination: destination ?? state.quote?.destination ?? "airport",
      offer: Number.isFinite(amount) ? amount : null,
      offerMeter: has(/\bmeter\b/),
      acceptAsk: agrees && !Number.isFinite(amount),
      items,
    };
  }
  if (has(/\b(walk|on foot|run|jog)\b/)) return { ...base, kind: "walk", destination };
  if (has(/\b(continue|keep going|go on|drive|faster|hurry)\b/)) return { ...base, kind: "continue" };
  if (has(/\b(wait|sit|relax|sleep|nap)\b/))
    return { ...base, kind: "wait", minutes: Number.isFinite(minutes) ? minutes : null };
  return base;
}
