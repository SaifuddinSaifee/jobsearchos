"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCount, formatMs, formatPercent, formatTokens, formatUsd } from "@/lib/usage/format";
import { actionLabel, modelLabel, stepLabel } from "@/lib/usage/labels";
import type { RollupRow } from "@/lib/usage/metrics";

const VIEWS = {
  action: { label: "By action", hint: "What you did that caused model calls.", name: actionLabel, first: "Action" },
  step: { label: "By step", hint: "Which kind of call it was.", name: stepLabel, first: "Step" },
  model: { label: "By model", hint: "Which model answered.", name: modelLabel, first: "Model" },
} as const;

type View = keyof typeof VIEWS;

function RollupTable({ rows, view, totalCost }: { rows: RollupRow[]; view: View; totalCost: number }) {
  const { name, first } = VIEWS[view];
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No calls in this range.</p>;
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">{first}</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Avg time</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            {view === "action" && <TableHead className="text-right">Per action</TableHead>}
            <TableHead className="pr-4 text-right">Share</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="pl-4 font-medium">{name(r.key)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(r.calls)}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">{r.errors || "-"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMs(r.avgMs)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatTokens(r.promptTokens + r.completionTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(r.costUsd)}</TableCell>
              {view === "action" && <TableCell className="text-right text-muted-foreground tabular-nums">{r.runs > 0 ? formatUsd(r.costUsd / r.runs) : "-"}</TableCell>}
              <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">{formatPercent(r.costUsd, totalCost)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Where the spend went, three ways. All the numbers are already loaded, so switching tabs is instant and keeps no URL state. */
export function BreakdownCard({ byAction, byStep, byModel, totalCost }: { byAction: RollupRow[]; byStep: RollupRow[]; byModel: RollupRow[]; totalCost: number }) {
  const [view, setView] = useState<View>("action");
  const rows = { action: byAction, step: byStep, model: byModel };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where it went</CardTitle>
        <CardDescription>{VIEWS[view].hint} Cost counts only calls with a known price.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList aria-label="Group by">
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <TabsTrigger key={v} value={v}>
                {VIEWS[v].label}
              </TabsTrigger>
            ))}
          </TabsList>
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <TabsContent key={v} value={v} className="animate-in pt-2 fade-in duration-300 motion-reduce:animate-none">
              <RollupTable rows={rows[v]} view={v} totalCost={totalCost} />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
