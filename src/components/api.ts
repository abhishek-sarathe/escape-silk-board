import type { Action, Outcome } from "@/game/types";
import type { PublicState } from "@/game/view";

export interface NewGameResponse {
  state: PublicState;
  token: string;
  narration: string;
}

export interface TurnResponse extends NewGameResponse {
  outcome: Outcome;
  action: Action;
  /** The Game Master agent's tool calls this turn ("How Anna decided"). */
  trace: { tool: string; args: Record<string, unknown>; result: string }[];
  via: { referee: string; narrator: string };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "The city stopped responding. Try again.");
  return data as T;
}

export const startGame = (seed?: number) => post<NewGameResponse>("/api/game/new", { seed });

export const playTurn = (token: string, input: string) => post<TurnResponse>("/api/game/turn", { token, input });
