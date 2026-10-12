import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuickLinksStrip } from "@/components/quick-links/quick-links";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/jobs/format";
import { STALE_APPLIED_DAYS, STALE_PREPARING_DAYS, statusInfo, type StatusGroup, type TabValue } from "@/lib/jobs/status";
import { dashboardData } from "@/lib/jobs/tracker";
import { listQuickLinks } from "@/lib/quick-links/service";
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
  const [data, links] = await Promise.all([dashboardData(), listQuickLinks()]);

  if (data.total === 0) {
    return (
      <div className="space-y-6">
        <QuickLinksStrip links={links} />
        <div className="space-y-3 rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing here yet. Add a job and this page will show what needs your attention.
          </p>
          <Button nativeButton={false} render={<Link href="/new" />}>Add your first application</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">Where your search stands, and what needs you next.</p>

      <QuickLinksStrip links={links} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {FUNNEL.map((f) => (
          <Link
            key={f.group}
            href={f.tab === "active" ? "/jobs" : `/jobs?tab=${f.tab}`}
            className="group/funnel rounded-xl border p-4 outline-none transition-[background-color,border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40 hover:shadow-sm active:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className={cn("text-3xl font-semibold tabular-nums", f.tone)}>{data.funnel[f.group]}</div>
            <div className="flex items-center justify-between gap-1 text-sm text-muted-foreground">
              {f.label}
              <ArrowRight
                aria-hidden
                className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,translate] duration-200 group-hover/funnel:translate-x-0 group-hover/funnel:opacity-100"
              />
            </div>
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
