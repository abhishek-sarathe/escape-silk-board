import { randomUUID } from "node:crypto";
import { INTRO } from "@/ai/narrator";
import { newGame } from "@/game/engine";
import { randomSeed } from "@/game/rng";
import { toPublic } from "@/game/view";
import { sealState } from "@/server/stateToken";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = Number(body?.seed);
  const seed = Number.isInteger(requested) && requested >= 0 && requested < 1_000_000 ? requested : randomSeed();
  const state = { ...newGame(seed), id: randomUUID() };
  return Response.json({ state: toPublic(state), token: sealState(state), narration: INTRO });
}
