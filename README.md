# Escape Silk Board

It's 7:00 PM at Silk Board junction. Your flight leaves at 9:40 and check-in closes at 8:55. You have ₹500, 32% battery and one cold samosa. Type anything; the city answers.

## Run it

```bash
npm install
cp .env.example .env.local   # then add OPENROUTER_API_KEY and/or GROQ_API_KEY, and STATE_SECRET
npm run dev                  # http://localhost:3000
```

No key? It still runs: a keyword parser and plain narration take over.

```bash
npm test        # rules, cheating, balance, agent and token tests
npm run usage   # LLM cost and token totals from the local call log
```

## How it works: code owns the facts, the LLM owns the story

Each turn, an AI reads the move, the engine decides, and an AI tells it. (The referee step below is the Game Master agent by default; see the next section.)

```
player text ──► referee LLM ──► Action (JSON: what they're trying to do)
                                   │
                                   ▼
                          engine (pure TypeScript)
                  time · battery · cash · location · bag
                  prices, travel times, events, win/lose
                                   │
                                   ▼  facts + refusals
                           narrator LLM ──► prose
```

- **The referee only classifies.** It turns "bhaiya, airport chaloge? meter se." into `{kind: "hire", transport: "auto", destination: "airport", offerMeter: true}`. It never sets a number. Its output is validated with zod; anything malformed falls back to a keyword parser.
- **The engine decides everything** (`src/game/engine.ts`): fares, haggling, travel time per stretch of road, battery drain, random events and the ending. Time only moves forward, you can't spend money you don't have, and a dead phone means no UPI, no app rides and no e-ticket at the gate.
- **The narrator only describes.** It gets the engine's facts and refusals, so the story can't contradict the numbers on screen.
- **Fair randomness.** Events and surge pricing come from a seeded RNG, so retrying a move doesn't re-roll them, and "Same evening, again" replays the same city.
- **Tamper-proof state.** The server is stateless. Game state travels as an AES-256-GCM token, so players can't edit their cash in devtools, and the auto driver's lowest price never reaches the browser.

### The Game Master agent (default)

By default, a tool-calling agent replaces the one-call referee (`src/ai/gameMaster.ts`; set `REFEREE_MODE=classic` for the old pipeline). Each turn it may:

- **Look things up**, free and read-only, with no game time passing (`src/ai/tools.ts`):
  - `look_around`: the player's situation;
  - `plan_trip`: the cheapest or fastest one- or two-leg route across buses, bike taxis, cabs, autos and walking;
  - `bus_options`: real BMTC lines from any place;
  - `quote`: what a trip would cost and roughly how long it takes.
- **Commit exactly one action** with `take_action`. Its arguments go through the same zod schema as the classic referee, and the engine still decides what happens.

The guardrails:

- **Budgets:** at most 4 model steps and 5 lookups per turn.
- **Tool allowlist:** an unknown tool gets an error, not an effect.
- **Bad arguments:** malformed arguments are returned to the model to fix.
- **Fallback:** classic referee, then keyword parser. A rate-limited agent goes straight to the parser.
- **Grounded answers:** what the agent looked up is passed to the narrator as true data, so answers like "the 293-AP is ₹40" come from the data, not the model.
- **Memory:** the agent keeps a few notes about the player in the encrypted state; they are never sent to the browser.
- **Trace:** each turn's tool calls appear in the UI under "How Anna decided".
- **Evals:** trajectory tests in `src/ai/gameMaster.test.ts` and `src/ai/tools.test.ts` use a scripted model, so they're deterministic and free.

The agent uses its own model slot (`GROQ_AGENT_MODEL`, default `openai/gpt-oss-20b`, or `OPENROUTER_AGENT_MODEL`), so its multi-step turns get their own rate-limit budget. Every call starts with the fixed system prompt, which is marked for caching on Claude models.

### The city

Eleven real places and three ways north: the Outer Ring Road (HSR, Marathahalli, KR Puram, then Hennur or Hebbal), through the centre (Koramangala, MG Road), and the back way out east via Hoskote. From Hebbal the NH-44 runs past Yelahanka with a ₹120 toll for cabs and autos. From Hennur the Hennur–Bagalur road goes straight up. The Hoskote road is toll-free. Autos haggle, and cabs and bike taxis need a living phone and charge surge prices. The city helps as well as hinders: a stranger may offer a lift, or a constable may wave your lane through.

- **Distances** are real road distances from OpenStreetMap routing (OSRM).
- **7 PM drive times** are empty-road times multiplied by a traffic factor per kind of road. TomTom's 2025 index puts Bengaluru's evening rush at ×2.15. At that, almost nobody makes check-in, so the factors are tuned down until scripted players win about half the time (`src/game/balance.ts`, enforced by `balance.test.ts`).
- **Buses** get the real Outer Ring Road bus priority lane between Silk Board and KR Puram.

The rules' numbers are in `src/game/rules.ts`.

### The city asks you things

At each stop the city may throw something at you (`src/game/encounters.ts`). The chance is higher in the last 30 minutes, and an airline "final call" SMS arrives with 20 minutes left. Some throws are happenings: rain, a VIP convoy, a stranger's free lift, a constable's green wave. Others are **decisions**, shown as buttons:

- **The bus breaks down:** share an auto with strangers (₹60), wait for the next one, or get off.
- **The driver offers a shortcut:** ₹50, a gamble that may save 10 minutes or cost 8.
- **A flooded underpass** (only in rain).
- **An annoying passenger** pitching his crypto startup, who knows which lane moves.
- **A kid wants your samosa:** trade it for a power-bank charge or ₹30.
- **Your friend Kiran calls** offering a lift: get to the meeting place in time and you ride to the airport free.

Ignore a decision and its default applies. Every effect is engine code; the narrator only tells it. "Keep going" rides stop by stop until something happens or you arrive, so turns are spent on choices, not waiting.

### Real BMTC buses

The buses are real. Three kinds run: ordinary BMTC (500-D, 201...), Vajra AC (V-500D...) and Vayu Vajra airport buses (KIA-8, KIA-7A...), plus the ₹40 ordinary 281-AP to the airport from Hebbal. Each bus has its real route number, its real route through the game's places, and a typical real fare. Players can ask for a kind of bus ("normal bus", "AC bus") or a route number ("500-D", "KIA-8"). A bus that doesn't run from where you are is refused, and the refusal names the ones that do.

The data comes from the [unofficial BMTC GTFS feed](https://github.com/Vonter/bmtc-gtfs) (ODbL-1.0), built into `src/game/busData.json` by `scripts/build-bus-data.py`. See [`src/game/busData.LICENSE.md`](src/game/busData.LICENSE.md). The feed's timetables are unreliable, so travel times use the game's traffic model, scaled per bus type by how fast that type runs in the feed. To rebuild:

```bash
curl -L -o bmtc.zip https://raw.githubusercontent.com/Vonter/bmtc-gtfs/main/gtfs/bmtc.zip
python -I scripts/build-bus-data.py bmtc.zip src/game/map.ts src/game/busData.json
```

## Models and cost

- **Primary (OpenRouter):** `anthropic/claude-haiku-5.5` is both the Game Master agent (low reasoning effort) and the narrator (reasoning off). `openai/gpt-oss-20b` is the classic referee, used only when the agent fails.
- **Backup (Groq free tier):** `qwen/qwen3.8-27b` narrates, `openai/gpt-oss-120b` referees and `openai/gpt-oss-20b` runs the agent. Each model has its own rate limit, so splitting them stretches the free budget.
- **Calls per turn:** one to four agent steps (most turns take one or two), then one narrator call. If every provider fails, a keyword parser and plain narration keep the game running.
- **Caching:** the system prompt, and inside an agent turn the game context, are marked for caching on Claude models. In testing, 77–91% of prompt tokens came from cache.
- **Cost:** about $0.0003 a turn, so a 10-turn game costs about $0.003. The footer shows tokens used this playthrough, plus the real USD cost when OpenRouter answers.

### Cost tracking

Every LLM call, success or failure, is logged to SQLite (`.data/llm-calls.sqlite`, via Node's built-in `node:sqlite`). Each row records the game, turn, role, provider, model, latency, prompt, cached and output tokens, and the cost OpenRouter reports. Prompts and player text are not stored.

- `npm run usage` prints totals, a breakdown by role and model, and the last games.
- `GET /api/usage` returns the same as JSON. It's open in development; in production it needs `?key=<USAGE_KEY>`.

On Vercel the log writes to the function's temporary disk. It works, but each server instance keeps its own copy and loses it when the instance is recycled or the app is redeployed, so `/api/usage` shows recent calls, not all-time totals. For durable production metering, point `src/server/llmLog.ts` at a hosted database; nothing else has to change. If the log can't be written, it switches itself off and turns carry on normally.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (or run `vercel` in the project folder). The framework is detected as Next.js; no build settings are needed.
2. Add these environment variables for Production (Settings → Environment Variables):

   | Variable | Value |
   |---|---|
   | `LLM_PROVIDERS` | `openrouter,groq` |
   | `OPENROUTER_API_KEY` | your OpenRouter key |
   | `OPENROUTER_MODEL` | `anthropic/claude-haiku-5.5` |
   | `OPENROUTER_AGENT_MODEL` | `anthropic/claude-haiku-5.5` |
   | `OPENROUTER_REFEREE_MODEL` | `openai/gpt-oss-20b` |
   | `GROQ_API_KEY` | your Groq key (backup) |
   | `STATE_SECRET` | a long random string. **Required:** without it, new games fail in production |
   | `LLM_TIMEOUT_MS` | `12000` |
   | `USAGE_KEY` | optional, a random string for `/api/usage?key=...` |

3. Deploy. The turn route allows up to 60 seconds (`maxDuration`), which covers a slow agent turn with provider fallback.

Changing `STATE_SECRET` later ends every game in progress: their tokens can no longer be opened.