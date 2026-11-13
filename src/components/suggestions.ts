// Tap-to-play moves for the current situation, so nobody faces an empty text box.
// They are ordinary player text: the referee and engine treat them like anything typed.
import type { PublicState } from "@/game/view";

export function suggest(s: PublicState): string[] {
  if (s.status !== "playing") return [];
  const phone = s.battery > 0;
  const friend = phone && !s.flags.includes("friend_called") ? ["Call my friend who knows a shortcut"] : [];

  if (s.location === "airport") return ["Run to the check-in counter", "Buy an overpriced coffee first"];

  if (s.ride) return ["Keep going", "Bhaiya, thoda jaldi!", ...friend, "Get out here"];

  if (s.quote) {
    const counter = Math.min(s.cash, Math.round((s.quote.ask * 0.7) / 10) * 10);
    const samosa = s.inventory.includes("samosa") ? " and my samosa" : "";
    return [
      ...(s.quote.ask <= s.cash ? [`Okay, ₹${s.quote.ask}. Chalo.`] : []),
      `I offer ₹${counter}${samosa}`,
      phone ? "Forget the auto. Book a bike taxi to Hebbal" : "Forget the auto. Where is the airport bus?",
    ];
  }

  if (s.turn === 0) return ["bhaiya, airport chaloge? meter se.", "Book a bike taxi to Hebbal", "Buy a chai and think about my life"];

  return [
    "Find an auto to the airport",
    phone ? "Book a bike taxi to Hebbal" : "Find a shop and charge my phone",
    "Take the airport bus",
    ...friend,
  ].slice(0, 4);
}
