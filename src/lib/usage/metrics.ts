import { and, desc, eq, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { llmCalls, type LlmCallRow } from "@/lib/db/schema";

import { RANGE_DAYS, type UsageRange } from "./ranges";

export { DEFAULT_RANGE, parseRange, RANGE_DAYS, USAGE_RANGES, type UsageRange } from "./ranges";

export type Totals = {
  calls: number;
  /** Calls that failed. A call the user stopped is counted under `stopped`, not here. */
  errors: number;
  stopped: number;
  costUsd: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Median and 95th percentile time of the calls that succeeded. */
  p50Ms: number;
  p95Ms: number;
  /** User actions: how many `withLlmContext` runs made calls. */
  runs: number;
  /** Calls that reported tokens but whose model has no known price, so they are missing from `costUsd`. */
  unpricedCalls: number;
};

export type DayRow = { date: string; costUsd: number; calls: number; errors: number };

export type RollupRow = {
  key: string;
  calls: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  avgMs: number;
  p95Ms: number;
  runs: number;
};

/** One call as the page shows it: the stored row, with dates as ISO strings so it can cross to a client component. */
export type CallRow = Omit<LlmCallRow, "createdAt"> & { createdAt: string };

export type UsageMetrics = {
  range: UsageRange;
  days: number;
  timeZone: string;
  totals: Totals;
  /** Spend over all time, whatever the range. */
  allTimeCostUsd: number;
  byDay: DayRow[];
  byAction: RollupRow[];
  byStep: RollupRow[];
  byModel: RollupRow[];
  errors: CallRow[];
  recent: CallRow[];
};

type RollupColumn = "action" | "step" | "model";

const serializable = (row: LlmCallRow): CallRow => ({ ...row, createdAt: row.createdAt.toISOString() });

/**
 * Usage over the range. Days are in `timeZone` (default: the server's, which for this local app is yours), so
 * "today" and the per-day bars follow your own midnight. Cost covers only calls whose model has a known price;
 * `totals.unpricedCalls` says how many are missing.
 */
export async function getUsageMetrics(
  range: UsageRange,
  opts: { db?: Db; now?: Date; timeZone?: string } = {},
): Promise<UsageMetrics> {
  const db = opts.db ?? defaultDb();
  const now = (opts.now ?? new Date()).toISOString();
  const timeZone = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const days = RANGE_DAYS[range];

  // The first local midnight in the window, as an instant.
  const [{ epoch }] = await db.execute<{ epoch: number }>(
    sql`select extract(epoch from ((date_trunc('day', ${now}::timestamptz at time zone ${timeZone}::text) - make_interval(days => ${days - 1}::int)) at time zone ${timeZone}::text))::float8 as epoch`,
  );
  const since = new Date(epoch * 1000);
  const sinceSql = sql`${since.toISOString()}::timestamptz`;

  const rollup = (column: RollupColumn) =>
    db.execute<{
      key: string;
      calls: number;
      errors: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost: number;
      avg_ms: number;
      p95_ms: number;
      runs: number;
    }>(sql`
      select ${sql.raw(column)} as key,
             count(*)::int as calls,
             (count(*) filter (where status = 'error'))::int as errors,
             coalesce(sum(prompt_tokens), 0)::float8 as prompt_tokens,
             coalesce(sum(completion_tokens), 0)::float8 as completion_tokens,
             coalesce(sum(cost_usd), 0)::float8 as cost,
             coalesce(avg(duration_ms), 0)::float8 as avg_ms,
             coalesce(percentile_cont(0.95) within group (order by duration_ms), 0)::float8 as p95_ms,
             count(distinct run_id)::int as runs
        from llm_calls
       where created_at >= ${sinceSql}
       group by 1
       order by cost desc, calls desc`);

  const toRollup = (rows: Awaited<ReturnType<typeof rollup>>): RollupRow[] =>
    rows.map((r) => ({
      key: r.key,
      calls: r.calls,
      errors: r.errors,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      costUsd: r.cost,
      avgMs: r.avg_ms,
      p95Ms: r.p95_ms,
      runs: r.runs,
    }));

  const [totalRows, allTime, dayRows, action, step, model, errorRows, recentRows] = await Promise.all([
    db.execute<{
      calls: number;
      errors: number;
      stopped: number;
      cost: number;
      prompt: number;
      cached: number;
      completion: number;
      reasoning: number;
      p50: number;
      p95: number;
      runs: number;
      unpriced: number;
    }>(sql`
      select count(*)::int as calls,
             (count(*) filter (where status = 'error'))::int as errors,
             (count(*) filter (where status = 'stopped'))::int as stopped,
             coalesce(sum(cost_usd), 0)::float8 as cost,
             coalesce(sum(prompt_tokens), 0)::float8 as prompt,
             coalesce(sum(cached_tokens), 0)::float8 as cached,
             coalesce(sum(completion_tokens), 0)::float8 as completion,
             coalesce(sum(reasoning_tokens), 0)::float8 as reasoning,
             coalesce(percentile_cont(0.5) within group (order by duration_ms) filter (where status = 'ok'), 0)::float8 as p50,
             coalesce(percentile_cont(0.95) within group (order by duration_ms) filter (where status = 'ok'), 0)::float8 as p95,
             count(distinct run_id)::int as runs,
             (count(*) filter (where cost_usd is null and prompt_tokens is not null))::int as unpriced
        from llm_calls
       where created_at >= ${sinceSql}`),
    db.execute<{ cost: number }>(sql`select coalesce(sum(cost_usd), 0)::float8 as cost from llm_calls`),
    db.execute<{ date: string; cost: number; calls: number; errors: number }>(sql`
      with local_days as (
        select generate_series(
                 date_trunc('day', ${now}::timestamptz at time zone ${timeZone}::text) - make_interval(days => ${days - 1}::int),
                 date_trunc('day', ${now}::timestamptz at time zone ${timeZone}::text),
                 interval '1 day') as day)
      select to_char(d.day, 'YYYY-MM-DD') as date,
             coalesce(sum(c.cost_usd), 0)::float8 as cost,
             count(c.id)::int as calls,
             (count(c.id) filter (where c.status = 'error'))::int as errors
        from local_days d
        left join llm_calls c
          on date_trunc('day', c.created_at at time zone ${timeZone}::text) = d.day and c.created_at >= ${sinceSql}
       group by d.day
       order by d.day`),
    rollup("action"),
    rollup("step"),
    rollup("model"),
    db.select().from(llmCalls).where(and(gte(llmCalls.createdAt, since), eq(llmCalls.status, "error"))).orderBy(desc(llmCalls.createdAt)).limit(10),
    db.select().from(llmCalls).where(gte(llmCalls.createdAt, since)).orderBy(desc(llmCalls.createdAt)).limit(25),
  ]);

  const t = totalRows[0];
  return {
    range,
    days,
    timeZone,
    totals: {
      calls: t.calls,
      errors: t.errors,
      stopped: t.stopped,
      costUsd: t.cost,
      promptTokens: t.prompt,
      cachedTokens: t.cached,
      completionTokens: t.completion,
      reasoningTokens: t.reasoning,
      p50Ms: t.p50,
      p95Ms: t.p95,
      runs: t.runs,
      unpricedCalls: t.unpriced,
    },
    allTimeCostUsd: allTime[0].cost,
    byDay: dayRows.map((d) => ({ date: d.date, costUsd: d.cost, calls: d.calls, errors: d.errors })),
    byAction: toRollup(action),
    byStep: toRollup(step),
    byModel: toRollup(model),
    errors: errorRows.map(serializable),
    recent: recentRows.map(serializable),
  };
}

/** Whether any call has ever been recorded, so the page can tell "no data yet" from "nothing in this range". */
export async function hasAnyCalls(db: Db = defaultDb()): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`select 1 as one from llm_calls limit 1`);
  return rows.length > 0;
}
