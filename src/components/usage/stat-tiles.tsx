import { TriangleAlert } from "lucide-react";
import { formatCount, formatMs, formatTokens, formatUsd } from "@/lib/usage/format";
import type { UsageMetrics } from "@/lib/usage/metrics";

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      {/* Proportional figures: tabular digits look loose at this size. */}
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** The headline numbers for the range. Spend leads. */
export function StatTiles({ metrics }: { metrics: UsageMetrics }) {
  const { totals } = metrics;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Spend" value={formatUsd(totals.costUsd)}>
        <p>{formatUsd(metrics.allTimeCostUsd)} all time</p>
        {totals.unpricedCalls > 0 && (
          <p className="flex items-start gap-1 text-amber-700 dark:text-amber-400">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {formatCount(totals.unpricedCalls)} {totals.unpricedCalls === 1 ? "call has" : "calls have"} no known price and {totals.unpricedCalls === 1 ? "is" : "are"} left out
            </span>
          </p>
        )}
      </Tile>
      <Tile label="Model calls" value={formatCount(totals.calls)}>
        <p>
          {formatCount(totals.runs)} {totals.runs === 1 ? "action" : "actions"}
        </p>
        <p>
          {formatCount(totals.errors)} failed{totals.stopped > 0 ? `, ${formatCount(totals.stopped)} stopped` : ""}
        </p>
      </Tile>
      <Tile label="Tokens" value={formatTokens(totals.promptTokens + totals.completionTokens)}>
        <p>
          {formatTokens(totals.promptTokens)} in ({formatTokens(totals.cachedTokens)} cached)
        </p>
        <p>
          {formatTokens(totals.completionTokens)} out ({formatTokens(totals.reasoningTokens)} thinking)
        </p>
      </Tile>
      <Tile label="Typical call time" value={formatMs(totals.p50Ms)}>
        <p>Slowest 1 in 20: {formatMs(totals.p95Ms)}</p>
        <p>Calls that succeeded</p>
      </Tile>
    </div>
  );
}
