"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";

/** The trace id of a call, shortened, with a button to copy the whole id. Paste it into Phoenix's search to find the trace. */
export function CopyTrace({ traceId }: { traceId: string | null }) {
  if (!traceId) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs text-muted-foreground">{traceId.slice(0, 8)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Copy trace id"
        onClick={() => copyText(traceId).then(() => toast.success("Trace id copied"), () => toast.error("Could not copy"))}
      >
        <Copy aria-hidden />
      </Button>
    </span>
  );
}
