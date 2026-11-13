// What the browser is allowed to see. The auto driver's floor price and the turn history stay on the server.
import type { GameState, LocationId } from "./types";

export interface PublicQuote {
  destination: LocationId;
  ask: number;
}

export type PublicState = Omit<GameState, "quote" | "history"> & { quote: PublicQuote | null };

export function toPublic(s: GameState): PublicState {
  const { quote, history, ...rest } = s;
  void history;
  return { ...rest, quote: quote ? { destination: quote.destination, ask: quote.ask } : null };
}
