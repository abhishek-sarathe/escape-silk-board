import { z } from "zod";
import { runGameMaster, type GameMasterResult } from "@/ai/gameMaster";
import { blankAction, parseLocally } from "@/ai/localParser";
import { narrate, plainNarration } from "@/ai/narrator";
import { nextMoves } from "@/ai/tools";
import type { LlmUsage } from "@/ai/providers";
import { interpret } from "@/ai/referee";
import { resolveTurn } from "@/game/engine";
import { HISTORY_LIMIT } from "@/game/rules";
import type { Usage } from "@/game/types";
import { toPublic } from "@/game/view";
import { after } from "next/server";
import { flushTurn, withTurn, type TurnContext } from "@/server/llmLog";
import { openState, sealState } from "@/server/stateToken";

// The agent can take up to 4 model steps, each with a 12 s timeout and a second provider to fall
// back to, then the narrator: 30 s could cut a slow turn off mid-way. Typical turns take a few seconds.
export const maxDuration = 60;

const MAX_INPUT = 280;
/** Most a turn waits for the AI to read the move, then to tell the story. */
const READ_BUDGET_MS = 20_000;
const NARRATE_BUDGET_MS = 12_000;

/** Resolves with `work`, or with `fallback()` if it takes longer than `ms` (a late result is ignored). */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[turn] AI step passed its ${ms} ms budget; answering without it`);
      resolve(fallback());
    }, ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const Body = z.object({
  token: z.string().min(16).max(60_000),
  input: z.string().max(2_000),
  /** Sent by the browser's ride timer, not typed: the ride moves one stop, with no AI reading the move. */
  auto: z.boolean().optional(),
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
  const meter: TurnContext = { gameId: state.id ?? `seed-${state.seed}`, seed: state.seed, turn: state.turn + 1 };
  // Time budgets keep a turn from hanging when a provider is slow: past them the game answers anyway,
  // with the keyword parser for the move and plain sentences for the story. Totals stay well under maxDuration.
  // The automatic ride only ever means "ride on", and only while riding with nothing to decide.
  const autoRide = parsed.data.auto === true && state.ride !== null && !state.pending;
  // An automatic stop isn't something the player said; describe it so the narrator doesn't explain it back.
  const said = autoRide ? "(says nothing; stays on board, watching the road)" : input;
  const { referee, next, outcome, narrator } = await withTurn(meter, async () => {
    const referee: GameMasterResult = autoRide
      ? { action: { ...blankAction("ride on"), kind: "continue" }, via: "auto-ride", usage: null, trace: [], lookups: [], notes: state.notes ?? [] }
      : await withDeadline(
      process.env.REFEREE_MODE === "classic"
        ? interpret(state, input).then((r) => ({ ...r, trace: [], lookups: [], notes: state.notes ?? [] }))
        : runGameMaster(state, input),
      READ_BUDGET_MS,
      () => ({
        action: parseLocally(state, input),
        via: "keyword-parser (slow AI)",
        usage: null,
        trace: [{ tool: "fallback", args: {}, result: "the AI took too long; keyword parser used" }],
        lookups: [],
        notes: state.notes ?? [],
      }),
    );
    const { state: next, outcome } = resolveTurn(state, referee.action, { oneStop: autoRide });
    next.notes = referee.notes;
    const narrator = await withDeadline(narrate(next, said, outcome, referee.lookups), NARRATE_BUDGET_MS, () => ({
      text: plainNarration(outcome, next),
      moves: [],
      via: "plain (slow AI)",
      usage: null,
    }));
    return { referee, next, outcome, narrator };
  });

  // Write this turn's cost rows after the response has gone out (Supabase in production; no-op otherwise).
  after(() => flushTurn(meter));

  next.history = [...next.history, { input: said, narration: narrator.text }].slice(-HISTORY_LIMIT);
  next.usage = addUsage(next.usage, referee.usage, narrator.usage);

  return Response.json({
    state: toPublic(next),
    token: sealState(next),
    narration: narrator.text,
    outcome,
    action: referee.action,
    trace: referee.trace,
    via: { referee: referee.via, narrator: narrator.via },
    suggestions: nextMoves(next),
    /** The narrator's playful ideas for what to try next (plain text; the agent reads them like anything typed). */
    moves: narrator.moves,
  });
}
