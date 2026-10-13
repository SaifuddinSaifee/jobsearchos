"use client";

import { Check, ChevronDown, Copy, FileWarning, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SOURCE_KIND_LABEL, failureFields, failureReport, parseFailure, type FailedSource } from "@/lib/career/failure";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/** Copies on click and briefly confirms it on the button itself, where the user is looking. */
function CopyButton({ text, label, className }: { text: () => string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() =>
        copyText(text()).then(
          () => setCopied(true),
          (e: Error) => toast.error(e.message),
        )
      }
    >
      <span key={copied ? "done" : "idle"} className="inline-flex items-center gap-1 animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        {copied ? <Check className="text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : label}
      </span>
    </Button>
  );
}

function FailureItem({ failure }: { failure: FailedSource }) {
  const [rawOpen, setRawOpen] = useState(false);
  const details = parseFailure(failure.error);
  // Source and kind are already in the heading.
  const fields = failureFields(failure, details).filter(([k]) => k !== "Source" && k !== "Kind");
  const hasRaw = details.raw !== "" && details.raw !== details.message;

  return (
    <li className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{failure.label}</span>
            <Badge variant="outline">{SOURCE_KIND_LABEL[failure.kind]}</Badge>
          </div>
          <p className="text-destructive">{details.message}</p>
        </div>
        <CopyButton text={() => failureReport([failure])} label="Copy" className="shrink-0" />
      </div>

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-all font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {hasRaw && (
        <div>
          <button
            type="button"
            aria-expanded={rawOpen}
            onClick={() => setRawOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", rawOpen && "rotate-180")}
              aria-hidden
            />
            Raw error
          </button>
          <Collapse open={rawOpen}>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-all">
              {details.raw}
            </pre>
          </Collapse>
        </div>
      )}
    </li>
  );
}

/** A "View details" button that opens every failed source's error, taken apart, with a way to copy it. */
export function FailureDialog({
  failures,
  retrying,
  onRetry,
  triggerClassName,
}: {
  failures: FailedSource[];
  retrying: boolean;
  onRetry: () => void;
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" className={triggerClassName} />}>
        <FileWarning aria-hidden />
        View details
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {failures.length} {failures.length === 1 ? "source" : "sources"} could not be prepared
          </DialogTitle>
          <DialogDescription>What went wrong with each one. Copy the details to share or look into them.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
          {failures.map((f) => (
            <FailureItem key={f.id} failure={f} />
          ))}
        </ul>
        <DialogFooter>
          <CopyButton text={() => failureReport(failures)} label="Copy all" />
          <Button size="sm" loading={retrying} onClick={onRetry}>
            <RotateCcw aria-hidden />
            Try again
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
