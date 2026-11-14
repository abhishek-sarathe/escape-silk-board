// Prints LLM cost and usage from the call log: `npm run usage` (or `npm run usage -- 50` for more games).
// With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set (e.g. in .env.local), it reads production from
// Supabase (supabase/llm_calls.sql); otherwise the local SQLite log.
import { existsSync } from "node:fs";
import path from "node:path";

const games = Number(process.argv[2] ?? 10);
const pct = (rows) => rows.map((r) => ({ ...r, cached_pct: r.prompt_tokens ? `${Math.round((100 * r.cached_tokens) / r.prompt_tokens)}%` : "-" }));

function print(summary, where) {
  console.log(`\nLLM usage (${where})\n\nTotal`);
  console.table(pct([summary.total]));
  console.log("By role and model");
  console.table(pct(summary.byModel ?? []));
  console.log(`Last ${games} games`);
  console.table(pct(summary.games ?? []));
}

// Accept the REST endpoint too ("https://x.supabase.co/rest/v1/"): it's an easy one to copy.
const url = process.env.SUPABASE_URL?.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (url && key) {
  const res = await fetch(`${url}/rest/v1/rpc/llm_usage_summary`, {
    method: "POST",
    // Legacy service_role keys are JWTs and also go in Authorization; the newer sb_secret_ keys go in apikey only.
    headers: { apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
    body: JSON.stringify({ games }),
  });
  if (!res.ok) {
    console.error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  print(await res.json(), "Supabase");
} else {
  const { DatabaseSync } = await import("node:sqlite");
  const file = process.env.LLM_LOG_DB ?? path.join(process.cwd(), ".data", "llm-calls.sqlite");
  if (!existsSync(file)) {
    console.log(`No LLM log yet at ${file}. Play a turn first.`);
    process.exit(0);
  }
  const db = new DatabaseSync(file, { readOnly: true });
  const T = `COUNT(*) AS calls, SUM(1 - ok) AS failed, ROUND(SUM(cost_usd), 5) AS cost_usd,
    SUM(prompt_tokens) AS prompt_tokens, SUM(cached_tokens) AS cached_tokens, SUM(completion_tokens) AS completion_tokens, CAST(ROUND(AVG(latency_ms)) AS INTEGER) AS avg_ms`;
  print(
    {
      total: db.prepare(`SELECT ${T} FROM llm_calls`).get(),
      byModel: db.prepare(`SELECT role, provider, model, ${T} FROM llm_calls GROUP BY 1, 2, 3 ORDER BY cost_usd DESC`).all(),
      games: db
        .prepare(`SELECT substr(MIN(at), 1, 16) AS started, seed, MAX(turn) AS turns, ${T} FROM llm_calls WHERE game_id IS NOT NULL GROUP BY game_id ORDER BY MIN(at) DESC LIMIT ?`)
        .all(games),
    },
    `SQLite: ${file}`,
  );
}
