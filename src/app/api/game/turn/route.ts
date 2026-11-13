import { z } from "zod";
import { narrate } from "@/ai/narrator";
import type { LlmUsage } from "@/ai/providers";
import { interpret } from "@/ai/referee";
import { resolveTurn } from "@/game/engine";
import { HISTORY_LIMIT } from "@/game/rules";
import type { Usage } from "@/game/types";
import { toPublic } from "@/game/view";
import { openState, sealState } from "@/server/stateToken";

export const maxDuration = 30;

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

  const referee = await interpret(state, input);
  const { state: next, outcome } = resolveTurn(state, referee.action);
  const narrator = await narrate(next, input, outcome);

  next.history = [...next.history, { input, narration: narrator.text }].slice(-HISTORY_LIMIT);
  next.usage = addUsage(next.usage, referee.usage, narrator.usage);

  return Response.json({
    state: toPublic(next),
    token: sealState(next),
    narration: narrator.text,
    outcome,
    action: referee.action,
    via: { referee: referee.via, narrator: narrator.via },
  });
}
