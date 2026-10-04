"use client";

import { Check, Circle, Loader2, MinusCircle } from "lucide-react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { FetchStep } from "@/lib/jobs/fetch/types";
import type { JobDraft } from "@/lib/jobs/schema";
import { readEvents } from "@/lib/sse";
import { JobReviewForm } from "./job-review-form";

type Duplicate = { id: string; company: string; title: string };
type Steps = Partial<Record<FetchStep["step"], FetchStep>>;

const STEP_LABELS: Record<FetchStep["step"], string> = {
  detect: "Detect source",
  fetch: "Fetch posting",
  render: "Render page",
  structure: "Structure with AI",
  company: "Research the company",
};

function StepList({ steps }: { steps: Steps }) {
  return (
    <ul className="space-y-1.5 rounded-lg border p-4 text-sm">
      {(Object.keys(STEP_LABELS) as FetchStep["step"][]).map((key) => {
        const s = steps[key];
        const Icon =
          s?.status === "running" ? Loader2 : s?.status === "done" ? Check : s?.status === "skipped" ? MinusCircle : Circle;
        return (
          <li key={key} className="flex items-center gap-2">
            <Icon className={`size-4 ${s?.status === "running" ? "animate-spin" : "text-muted-foreground"}`} />
            <span className={s ? "" : "text-muted-foreground"}>{STEP_LABELS[key]}</span>
            {s?.detail && <span className="text-xs text-muted-foreground">· {s.detail}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function NewApplication() {
  const [mode, setMode] = useQueryState("mode", { defaultValue: "url" });
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Steps>({});
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [draft, setDraft] = useState<{ key: number; value: JobDraft } | null>(null);

  async function extract() {
    setBusy(true);
    setSteps({});
    setDuplicate(null);
    try {
      const res = await fetch("/api/jobs/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "paste" ? { text, url: url || undefined } : { url }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not extract the job");
      }
      for await (const { event, data } of readEvents(res)) {
        if (event === "step") {
          const s = data as FetchStep;
          setSteps((prev) => ({ ...prev, [s.step]: s }));
        } else if (event === "duplicate") {
          setDuplicate(data as Duplicate);
        } else if (event === "result") {
          setDraft({ key: Date.now(), value: data as JobDraft });
        } else if (event === "error") {
          const err = data as { code: string; message: string };
          toast.error(err.message);
          // Sites that block fetching: hand over to the paste-text path with the URL kept.
          if (["blocked", "empty"].includes(err.code) && mode === "url") void setMode("paste");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not extract the job");
    } finally {
      setBusy(false);
    }
  }

  if (draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Extracted via <strong>{draft.value.fetchMethod}</strong>. Check the fields against the
            original text, fix anything wrong, then save.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            Discard
          </Button>
        </div>
        <JobReviewForm key={draft.key} initial={draft.value} />
      </div>
    );
  }

  const canSubmit = mode === "paste" ? text.trim().length > 0 : url.trim().length > 0;

  return (
    <div className="max-w-2xl space-y-4">
      <Tabs value={mode} onValueChange={(v) => void setMode(v as string)}>
        <TabsList>
          <TabsTrigger value="url">Job URL</TabsTrigger>
          <TabsTrigger value="paste">Paste JD text</TabsTrigger>
        </TabsList>
      </Tabs>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) void extract();
        }}
      >
        {mode === "paste" ? (
          <>
            <p className="text-sm text-muted-foreground">
              For sites that block fetching (LinkedIn, Indeed): copy the job description and paste it here.
            </p>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Job URL (optional, used for de-duplication)"
            />
            <Textarea
              rows={14}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the full job description…"
            />
          </>
        ) : (
          <Input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://boards.greenhouse.io/company/jobs/123456"
          />
        )}
        <Button type="submit" disabled={!canSubmit || busy}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Extracting…" : "Extract job"}
        </Button>
      </form>

      {(busy || Object.keys(steps).length > 0) && <StepList steps={steps} />}

      {duplicate && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
          Already saved: <strong>{duplicate.title}</strong> at <strong>{duplicate.company}</strong>.{" "}
          <Link href="/jobs" className="underline">
            View in Jobs
          </Link>
        </div>
      )}
    </div>
  );
}
