// Prints LLM cost and usage from the call log: `npm run usage` (or `npm run usage -- 50` for more games).
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file = process.env.LLM_LOG_DB ?? path.join(process.cwd(), ".data", "llm-calls.sqlite");
if (!existsSync(file)) {
  console.log(`No LLM log yet at ${file}. Play a turn first.`);
  process.exit(0);
}
const db = new DatabaseSync(file, { readOnly: true });
const games = Number(process.argv[2] ?? 10);
const T = `COUNT(*) AS calls, SUM(1 - ok) AS failed, ROUND(SUM(cost_usd), 5) AS cost_usd,
  SUM(prompt_tokens) AS prompt, SUM(cached_tokens) AS cached, SUM(completion_tokens) AS output, CAST(ROUND(AVG(latency_ms)) AS INTEGER) AS avg_ms`;
const pct = (rows) => rows.map((r) => ({ ...r, cached_pct: r.prompt ? `${Math.round((100 * r.cached) / r.prompt)}%` : "-" }));

console.log("\nTotal");
console.table(pct([db.prepare(`SELECT ${T} FROM llm_calls`).get()]));
console.log("By role and model");
console.table(pct(db.prepare(`SELECT role, provider, model, ${T} FROM llm_calls GROUP BY 1, 2, 3 ORDER BY cost_usd DESC`).all()));
console.log(`Last ${games} games`);
console.table(
  pct(
    db
      .prepare(`SELECT substr(MIN(at), 1, 16) AS started, seed, MAX(turn) AS turns, ${T} FROM llm_calls WHERE game_id IS NOT NULL GROUP BY game_id ORDER BY MIN(at) DESC LIMIT ?`)
      .all(games),
  ),
);
