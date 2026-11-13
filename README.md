# Escape Silk Board

It's 7:00 PM at Silk Board junction. Your flight leaves at 9:40 and check-in closes at 8:55. You have ₹500, 32% battery and one cold samosa. Type anything; the city answers.

## Run it

```bash
npm install
cp .env.example .env.local   # then add GROQ_API_KEY (free at console.groq.com)
npm run dev                  # http://localhost:3000
```

No key? It still runs: a keyword parser and plain narration take over.

```bash
npm test        # rules, cheating, balance and token tests
```

## How it works: code owns the facts, the LLM owns the story

Each turn makes two LLM calls with the engine in between:

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

### The city

Two routes north, both through Hebbal: the Outer Ring Road (longer, has airport buses) and through the centre (shorter, no airport bus until MG Road). Autos haggle, cabs and bike taxis need a living phone and charge surge prices, and buses are cheap but slow. All the numbers are in `src/game/rules.ts`.

## Models and cost

- Default: Groq `llama-3.3-70b-versatile` (free tier), with OpenRouter as a paid fallback. Set `LLM_PROVIDERS=openrouter,groq` to swap the order.
- Each turn makes two calls (referee + narrator). The footer shows tokens used this playthrough, plus the real USD cost when OpenRouter is answering.

## Deploy (Vercel)

Import the repo and set `GROQ_API_KEY`, `STATE_SECRET` (any long random string) and optionally `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`.
