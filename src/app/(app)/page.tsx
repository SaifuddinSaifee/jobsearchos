import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/jobs/format";
import { STALE_APPLIED_DAYS, STALE_PREPARING_DAYS, statusInfo, type StatusGroup, type TabValue } from "@/lib/jobs/status";
import { dashboardData } from "@/lib/jobs/tracker";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FUNNEL: { group: StatusGroup; label: string; tab: TabValue; tone: string }[] = [
  { group: "active", label: "Saved & preparing", tab: "active", tone: "text-slate-600 dark:text-slate-300" },
  { group: "applied", label: "Applied", tab: "applied", tone: "text-blue-600 dark:text-blue-300" },
  { group: "interviews", label: "Interviews", tab: "interviews", tone: "text-violet-600 dark:text-violet-300" },
  { group: "offers", label: "Offers", tab: "offers", tone: "text-emerald-600 dark:text-emerald-300" },
  { group: "closed", label: "Closed", tab: "closed", tone: "text-zinc-500" },
];

export default async function DashboardPage() {
  const data = await dashboardData();

  if (data.total === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 pt-10">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          Nothing here yet. Add a job and this page will show what needs your attention.
        </p>
        <Button nativeButton={false} render={<Link href="/new" />}>Add your first application</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Where your search stands, and what needs you next.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {FUNNEL.map((f) => (
          <Link
            key={f.group}
            href={f.tab === "active" ? "/jobs" : `/jobs?tab=${f.tab}`}
            className="rounded-xl border p-4 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className={cn("text-3xl font-semibold tabular-nums", f.tone)}>{data.funnel[f.group]}</div>
            <div className="text-sm text-muted-foreground">{f.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            {data.needsAttention.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
            ) : (
              <ul className="space-y-3">
                {data.needsAttention.map((i) => (
                  <li key={i.jobId} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/jobs?job=${i.jobId}`} className="min-w-0 hover:underline">
                      <span className="block truncate font-medium">{i.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {i.company} · {i.status === "applied" ? "no update" : "still preparing"} for {i.daysSince} days
                      </span>
                    </Link>
                    <Badge variant="secondary">{statusInfo(i.status).label}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="pt-3 text-xs text-muted-foreground">
              Applied with no change for {STALE_APPLIED_DAYS}+ days, or preparing for {STALE_PREPARING_DAYS}+ days.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {data.recent.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/jobs?job=${e.jobId}`} className="min-w-0 hover:underline">
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.company} ·{" "}
                      {e.from && (
                        <>
                          {statusInfo(e.from).label}
                          <ArrowRight className="mx-1 inline size-3 align-text-bottom" aria-label="to" />
                        </>
                      )}
                      {statusInfo(e.to).label}
                      {e.note === "Undo" ? " (undo)" : ""}
                    </span>
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(e.at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
