import { ExternalLink } from "lucide-react";
import { BreakdownCard } from "@/components/usage/breakdown-card";
import { FailedCalls, RecentCalls } from "@/components/usage/calls-table";
import { DailyCostChart } from "@/components/usage/daily-cost-chart";
import { RangeFrame } from "@/components/usage/range-frame";
import { StatTiles } from "@/components/usage/stat-tiles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";
import { formatCount, formatUsd } from "@/lib/usage/format";
import { getUsageMetrics, hasAnyCalls, parseRange } from "@/lib/usage/metrics";

export const dynamic = "force-dynamic";

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const [metrics, any] = await Promise.all([getUsageMetrics(range), hasAnyCalls()]);
  const phoenixUrl = env().PHOENIX_UI_URL || env().PHOENIX_COLLECTOR_ENDPOINT;
  const { totals } = metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="text-sm text-muted-foreground">What the AI calls behind the app cost, how long they take, and which ones fail.</p>
        {phoenixUrl && (
          <Button variant="outline" nativeButton={false} render={<a href={phoenixUrl} target="_blank" rel="noreferrer" />}>
            Open Phoenix
            <ExternalLink aria-hidden />
          </Button>
        )}
      </div>

      {!any ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No AI calls recorded yet. Every call is recorded from now on: adding a job, reading a resume, researching a company, finding people.
        </div>
      ) : (
        <RangeFrame>
          {totals.calls === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              No AI calls in the last {metrics.days} days. Try a longer range.
            </div>
          ) : (
            <>
              <StatTiles metrics={metrics} />

              <Card>
                <CardHeader>
                  <CardTitle>Spend per day</CardTitle>
                  <CardDescription>
                    {formatUsd(totals.costUsd)} over {metrics.days} days across {formatCount(totals.calls)} calls.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DailyCostChart days={metrics.byDay} timeZone={metrics.timeZone} />
                </CardContent>
              </Card>

              <BreakdownCard byAction={metrics.byAction} byStep={metrics.byStep} byModel={metrics.byModel} totalCost={totals.costUsd} />
              <FailedCalls calls={metrics.errors} />
              <RecentCalls calls={metrics.recent} />
            </>
          )}
        </RangeFrame>
      )}
    </div>
  );
}
