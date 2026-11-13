import type { Action, Outcome } from "@/game/types";
import type { PublicState } from "@/game/view";

export interface NewGameResponse {
  state: PublicState;
  token: string;
  narration: string;
  /** Next moves worked out by the server from the real route planner (no AI), when it has some. */
  suggestions?: string[];
}

export interface TurnResponse extends NewGameResponse {
  outcome: Outcome;
  action: Action;
  /** The Game Master agent's tool calls this turn ("How Anna decided"). */
  trace: { tool: string; args: Record<string, unknown>; result: string }[];
  via: { referee: string; narrator: string };
}

/** The server gives a turn about 35 s at most; past this the browser stops waiting. */
const CLIENT_TIMEOUT_MS = 45_000;

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(timedOut ? "The city took too long to answer. Your move is still in the box: press Go to try again." : "Couldn't reach the city. Check your connection and press Go again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "The city stopped responding. Press Go to try again.");
  return data as T;
}

export const startGame = (seed?: number) => post<NewGameResponse>("/api/game/new", { seed });

export const playTurn = (token: string, input: string) => post<TurnResponse>("/api/game/turn", { token, input });
