import { randomUUID } from "node:crypto";
import { INTRO } from "@/ai/narrator";
import { nextMoves } from "@/ai/tools";
import { newGame } from "@/game/engine";
import { randomSeed } from "@/game/rng";
import { toPublic } from "@/game/view";
import { sealState } from "@/server/stateToken";

/** Happening ids look like "rain" or "decision:shortcut"; anything else from the browser is dropped. */
const HAPPENING_ID = /^(decision:)?[a-z_]{2,24}$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = Number(body?.seed);
  const replay = Number.isInteger(requested) && requested >= 0 && requested < 1_000_000;
  const seed = replay ? requested : randomSeed();
  // A brand-new evening steers away from what this player saw in their last few games. A replay
  // ("same evening, again" or a shared link) ignores it, so the same seed gives the same city.
  const avoid = !replay && Array.isArray(body?.recent) ? [...new Set(body.recent.filter((x: unknown) => typeof x === "string" && HAPPENING_ID.test(x)))].slice(0, 12) : [];
  const state = { ...newGame(seed), id: randomUUID(), ...(avoid.length ? { avoid: avoid as string[] } : {}) };
  return Response.json({ state: toPublic(state), token: sealState(state), narration: INTRO, suggestions: nextMoves(state) });
}
