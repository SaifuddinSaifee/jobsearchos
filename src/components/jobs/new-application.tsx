"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Info, ListPlus, Loader2, X } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { enqueueTextAction, enqueueUrlsAction } from "@/app/(app)/new/actions";
import { QueueList } from "@/components/queue/queue-list";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { JobDraft } from "@/lib/jobs/schema";
import type { QueueItem } from "@/lib/queue/types";
import { JobReviewForm } from "./job-review-form";

type Skipped = { input: string; reason: string }[];

function AddForm() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useQueryState("mode", { defaultValue: "url" });
  const [urls, setUrls] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<Skipped>([]);

  const canSubmit = mode === "paste" ? text.trim().length > 0 : urls.trim().length > 0;

  async function submit() {
    setBusy(true);
    const res = mode === "paste" ? await enqueueTextAction(text, url || undefined) : await enqueueUrlsAction(urls);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setSkipped(res.skipped);
    if (res.queued.length) {
      toast.success(`Added ${res.queued.length} to the queue`, {
        description: res.skipped.length ? `${res.skipped.length} skipped, see below` : "You can leave this page; they keep running.",
      });
      if (mode === "paste") {
        setText("");
        setUrl("");
      } else setUrls("");
    } else if (res.skipped.length) {
      toast.message("Nothing new to add", { description: "See the reasons below." });
    }
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
  }

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => void setMode(v as string)}>
        <TabsList>
          <TabsTrigger value="url">Job URLs</TabsTrigger>
          <TabsTrigger value="paste">Paste JD text</TabsTrigger>
        </TabsList>
      </Tabs>

      <form
        className="max-w-2xl space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) void submit();
        }}
      >
        {mode === "paste" ? (
          <div key="paste" className="animate-in fade-in slide-in-from-bottom-1 space-y-3 duration-200 motion-reduce:animate-none">
            <p className="text-sm text-muted-foreground">
              For sites that block fetching (LinkedIn, Indeed): copy the job description and paste it here.
            </p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Job URL (optional, used to spot duplicates)" aria-label="Job URL" />
            <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full job description…" aria-label="Job description" />
          </div>
        ) : (
          <div key="url" className="animate-in fade-in slide-in-from-bottom-1 space-y-1.5 duration-200 motion-reduce:animate-none">
            <Textarea
              rows={Math.min(Math.max(urls.split("\n").length, 3), 10)}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={"https://boards.greenhouse.io/company/jobs/123456\nhttps://jobs.lever.co/company/abc-123\n…one job URL per line"}
              aria-label="Job URLs"
              className="resize-none transition-[height] duration-200 motion-reduce:transition-none"
            />
            <p className="text-xs text-muted-foreground">
              Add as many as you like. They are processed in the background, two at a time, and saved automatically when
              the result looks complete. Anything doubtful waits for your review.
            </p>
          </div>
        )}
        <Button type="submit" disabled={!canSubmit || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ListPlus />}
          Add to queue
        </Button>
      </form>

      <Collapse open={skipped.length > 0}>
        <div role="status" className="max-w-2xl rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-medium">
              <Info className="size-4 text-muted-foreground" aria-hidden /> Not added
            </div>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setSkipped([])}>
              <X />
            </Button>
          </div>
          <ul className="mt-1.5 space-y-1">
            {skipped.map((s) => (
              <li key={s.input} className="flex flex-wrap gap-x-2">
                <span className="max-w-full truncate font-mono text-xs">{s.input}</span>
                <span className="text-muted-foreground">{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </Collapse>
    </div>
  );
}

function ReviewPanel({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["queue-draft", id],
    queryFn: async () => {
      const res = await fetch(`/api/queue/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? "This item is gone." : "Could not load it.");
      return (await res.json()) as { item: QueueItem; draft: JobDraft | null };
    },
    retry: false,
    staleTime: Infinity,
  });
  const queryClient = useQueryClient();

  return (
    <div className="animate-in fade-in slide-in-from-right-3 space-y-4 duration-300 motion-reduce:animate-none">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft /> Back to the queue
      </Button>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : !data?.draft || data.item.status !== "needs_review" ? (
        <p className="text-sm text-muted-foreground">This item no longer needs review.</p>
      ) : (
        <>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <strong className="font-medium">{data.item.label}</strong>
            <span className="text-muted-foreground"> was not saved automatically. {data.item.error}</span>
          </div>
          <JobReviewForm
            key={id}
            initial={data.draft}
            queueId={id}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ["queue"] });
              toast.success("Job saved");
              onBack();
            }}
          />
        </>
      )}
    </div>
  );
}

export function NewApplication() {
  const [review, setReview] = useQueryState("review", parseAsString);

  if (review) return <ReviewPanel key={review} id={review} onBack={() => void setReview(null)} />;
  return (
    <div className="animate-in fade-in slide-in-from-left-3 space-y-8 duration-300 motion-reduce:animate-none">
      <AddForm />
      <QueueList />
    </div>
  );
}
