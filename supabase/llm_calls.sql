-- Production LLM cost log for Escape Silk Board (src/server/llmLog.ts).
-- Run once in the Supabase SQL editor. Same columns as the local SQLite log.
-- No prompts or player text are stored: this is a meter, not a transcript.

create table if not exists public.llm_calls (
  id                bigint generated always as identity primary key,
  at                timestamptz      not null default now(),
  game_id           text,
  seed              integer,
  turn              integer,
  role              text             not null,  -- agent | referee | narrator
  provider          text             not null,  -- openrouter | groq
  model             text             not null,
  ok                boolean          not null,
  error             text,                       -- first 300 chars, never a prompt
  latency_ms        integer          not null,
  prompt_tokens     integer          not null,
  cached_tokens     integer          not null,
  completion_tokens integer          not null,
  cost_usd          double precision not null
);

create index if not exists llm_calls_game on public.llm_calls (game_id);
create index if not exists llm_calls_at   on public.llm_calls (at desc);

-- Row level security on, with no policies: the anon and authenticated roles can't read or write.
-- The server uses the service-role key, which bypasses RLS.
alter table public.llm_calls enable row level security;

-- Totals for GET /api/usage and `npm run usage`: overall, per role and model, per day, and recent games.
create or replace function public.llm_usage_summary(games integer default 20)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total', (
      select json_build_object(
        'calls', count(*),
        'failed', count(*) filter (where not ok),
        'cost_usd', round(coalesce(sum(cost_usd), 0)::numeric, 6),
        'prompt_tokens', coalesce(sum(prompt_tokens), 0),
        'cached_tokens', coalesce(sum(cached_tokens), 0),
        'completion_tokens', coalesce(sum(completion_tokens), 0),
        'avg_ms', round(avg(latency_ms))
      )
      from llm_calls
    ),
    'byModel', (
      select coalesce(json_agg(x order by x.cost_usd desc), '[]'::json)
      from (
        select role, provider, model,
               count(*) as calls,
               count(*) filter (where not ok) as failed,
               round(sum(cost_usd)::numeric, 6) as cost_usd,
               sum(prompt_tokens) as prompt_tokens,
               sum(cached_tokens) as cached_tokens,
               sum(completion_tokens) as completion_tokens,
               round(avg(latency_ms)) as avg_ms
        from llm_calls
        group by role, provider, model
      ) x
    ),
    'byDay', (
      select coalesce(json_agg(x order by x.day desc), '[]'::json)
      from (
        select to_char(at, 'YYYY-MM-DD') as day,
               count(*) as calls,
               count(*) filter (where not ok) as failed,
               round(sum(cost_usd)::numeric, 6) as cost_usd,
               sum(prompt_tokens) as prompt_tokens,
               sum(cached_tokens) as cached_tokens,
               sum(completion_tokens) as completion_tokens,
               round(avg(latency_ms)) as avg_ms
        from llm_calls
        group by 1
        order by 1 desc
        limit 14
      ) x
    ),
    'games', (
      select coalesce(json_agg(x order by x.started desc), '[]'::json)
      from (
        select game_id,
               min(seed) as seed,
               min(at) as started,
               max(turn) as turns,
               count(*) as calls,
               count(*) filter (where not ok) as failed,
               round(sum(cost_usd)::numeric, 6) as cost_usd,
               sum(prompt_tokens) as prompt_tokens,
               sum(cached_tokens) as cached_tokens,
               sum(completion_tokens) as completion_tokens
        from llm_calls
        where game_id is not null
        group by game_id
        order by min(at) desc
        limit games
      ) x
    )
  );
$$;

-- Only the server (service role) may call it.
revoke all on function public.llm_usage_summary(integer) from public, anon, authenticated;
grant execute on function public.llm_usage_summary(integer) to service_role;
