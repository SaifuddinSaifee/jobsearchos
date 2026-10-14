import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMs, formatStamp, formatTokens, formatUsd } from "@/lib/usage/format";
import { actionLabel, modelLabel, stepLabel } from "@/lib/usage/labels";
import type { CallRow } from "@/lib/usage/metrics";
import { CopyTrace } from "./copy-trace";

/** What a call was for, as a link to it when it still exists. Ids are not foreign keys, so a deleted target is a dead link. */
function Target({ call }: { call: CallRow }) {
  const link = call.jobId
    ? { href: `/jobs?job=${call.jobId}`, label: "Job" }
    : call.companyId
      ? { href: `/companies/${call.companyId}`, label: "Company" }
      : call.documentId
        ? { href: `/library/${call.documentId}`, label: "Document" }
        : call.proposalId
          ? { href: "/library/record", label: "Career record" }
          : null;
  if (!link) return <span className="text-muted-foreground">-</span>;
  return (
    <Link href={link.href} className="underline-offset-4 transition-colors hover:underline">
      {link.label}
    </Link>
  );
}

const STATUS = {
  ok: { label: "OK", variant: "secondary" },
  error: { label: "Failed", variant: "destructive" },
  stopped: { label: "Stopped", variant: "outline" },
} as const;

/** The first cell of a row: which step it was, with the action and time beneath. */
function CallCell({ call, detail }: { call: CallRow; detail: string }) {
  return (
    <TableCell className="pl-4 whitespace-nowrap">
      <div className="font-medium">{stepLabel(call.step)}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </TableCell>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** The latest calls, newest first. */
export function RecentCalls({ calls }: { calls: CallRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent calls</CardTitle>
        <CardDescription>The latest {calls.length || ""} calls in this range, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <Empty>No calls in this range.</Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Call</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">In / out</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="pr-4">Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => {
                  const status = STATUS[c.status];
                  return (
                    <TableRow key={c.id}>
                      <CallCell call={c} detail={`${actionLabel(c.action)}, ${formatStamp(c.createdAt)}`} />
                      <TableCell className="whitespace-nowrap">
                        {modelLabel(c.model)}
                        {c.reasoningEffort && <span className="text-muted-foreground"> ({c.reasoningEffort})</span>}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {c.promptTokens === null ? "-" : `${formatTokens(c.promptTokens)} / ${formatTokens(c.completionTokens ?? 0)}`}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{formatMs(c.durationMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.costUsd === null ? <span className="text-muted-foreground">-</span> : formatUsd(c.costUsd)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Target call={c} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <CopyTrace traceId={c.traceId} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The latest failed calls with the reason. A call the user stopped is not a failure and is left out. */
export function FailedCalls({ calls }: { calls: CallRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Failures</CardTitle>
        <CardDescription>The latest failed calls in this range, with what went wrong.</CardDescription>
      </CardHeader>
      <CardContent>
        {calls.length === 0 ? (
          <Empty>No failed calls in this range.</Empty>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Call</TableHead>
                  <TableHead>What went wrong</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="pr-4">Trace</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((c) => (
                  <TableRow key={c.id}>
                    <CallCell call={c} detail={`${actionLabel(c.action)}, ${formatStamp(c.createdAt)}`} />
                    <TableCell className="min-w-64 whitespace-normal break-words">{c.error ?? "Unknown error"}</TableCell>
                    <TableCell className="whitespace-nowrap">{modelLabel(c.model)}</TableCell>
                    <TableCell>
                      <Target call={c} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <CopyTrace traceId={c.traceId} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
