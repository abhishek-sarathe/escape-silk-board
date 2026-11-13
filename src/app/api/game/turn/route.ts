import { z } from "zod";
import { runGameMaster, type GameMasterResult } from "@/ai/gameMaster";
import { narrate } from "@/ai/narrator";
import type { LlmUsage } from "@/ai/providers";
import { interpret } from "@/ai/referee";
import { resolveTurn } from "@/game/engine";
import { HISTORY_LIMIT } from "@/game/rules";
import type { Usage } from "@/game/types";
import { toPublic } from "@/game/view";
import { withTurn } from "@/server/llmLog";
import { openState, sealState } from "@/server/stateToken";

// The agent can take up to 4 model steps, each with a 12 s timeout and a second provider to fall
// back to, then the narrator: 30 s could cut a slow turn off mid-way. Typical turns take a few seconds.
export const maxDuration = 60;

const MAX_INPUT = 280;

const Body = z.object({
  token: z.string().min(16).max(60_000),
  input: z.string().max(2_000),
});

function cleanInput(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INPUT);
}

function addUsage(total: Usage, ...calls: (LlmUsage | null)[]): Usage {
  const next = { ...total };
  for (const u of calls) {
    if (!u) continue;
    next.calls += 1;
    next.promptTokens += u.promptTokens;
    next.completionTokens += u.completionTokens;
    next.costUsd += u.costUsd;
    next.cachedTokens = (next.cachedTokens ?? 0) + (u.cachedTokens ?? 0);
  }
  return next;
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, "Bad request.");

  const state = openState(parsed.data.token);
  if (!state) return fail(400, "This game can't be resumed. Start a new one.");
  if (state.status !== "playing") return fail(409, "This game is already over.");

  const input = cleanInput(parsed.data.input);
  if (!input) return fail(400, "Type what you want to do.");

  // REFEREE_MODE=classic uses the single-call referee; the default is the tool-using Game Master agent.
  // Every LLM call inside is metered against this game and turn (src/server/llmLog.ts).
  const meter = { gameId: state.id ?? `seed-${state.seed}`, seed: state.seed, turn: state.turn + 1 };
  const { referee, next, outcome, narrator } = await withTurn(meter, async () => {
    const referee: GameMasterResult =
      process.env.REFEREE_MODE === "classic"
        ? { ...(await interpret(state, input)), trace: [], lookups: [], notes: state.notes ?? [] }
        : await runGameMaster(state, input);
    const { state: next, outcome } = resolveTurn(state, referee.action);
    next.notes = referee.notes;
    const narrator = await narrate(next, input, outcome, referee.lookups);
    return { referee, next, outcome, narrator };
  });

  next.history = [...next.history, { input, narration: narrator.text }].slice(-HISTORY_LIMIT);
  next.usage = addUsage(next.usage, referee.usage, narrator.usage);

  return Response.json({
    state: toPublic(next),
    token: sealState(next),
    narration: narrator.text,
    outcome,
    action: referee.action,
    trace: referee.trace,
    via: { referee: referee.via, narrator: narrator.via },
  });
}
