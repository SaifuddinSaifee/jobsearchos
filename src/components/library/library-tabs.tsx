"use client";

import { Plus } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapse } from "@/components/ui/collapse";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DocumentKind } from "@/lib/documents/types";
import { KIND_LABELS } from "@/lib/documents/types";
import { cn } from "@/lib/utils";
import { AddDocument } from "./add-document";
import { DocumentTable } from "./document-table";
import type { JobChoice, LibraryRow } from "./types";

const TABS = ["resumes", "cover-letters", "emails"] as const;
type Tab = (typeof TABS)[number];

const TAB_KIND: Record<Tab, DocumentKind> = { resumes: "resume", "cover-letters": "cover_letter", emails: "email" };
const TAB_LABEL: Record<Tab, string> = { resumes: "Resumes", "cover-letters": "Cover letters", emails: "Emails" };
const BLURB: Record<Tab, string> = {
  resumes: "Every resume you have, as text you can read and search. Your base resume is the one attached to emails by default.",
  "cover-letters": "Cover letters you have written, kept so you can reuse what worked.",
  emails: "Emails you sent from this app appear here on their own. Add older ones by pasting them in.",
};
const EMPTY: Record<Tab, string> = {
  resumes: "No resumes yet. Add one with the button above.",
  "cover-letters": "No cover letters yet.",
  emails: "No emails yet. Ones you send from a job appear here.",
};

export function LibraryTabs({ rows, jobs }: { rows: LibraryRow[]; jobs: JobChoice[] }) {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("resumes"));
  const [adding, setAdding] = useState(false);
  const hasBase = rows.some((r) => r.isBase);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        setTab(v as Tab);
        setAdding(false);
      }}
    >
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t} value={t}>
            {TAB_LABEL[t]} <span className="ml-1 text-xs tabular-nums text-muted-foreground">{rows.filter((r) => r.kind === TAB_KIND[t]).length}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {TABS.map((t) => (
        <TabsContent key={t} value={t} className="space-y-4 pt-4">
          <div className="flex items-start justify-between gap-4">
            <p className="max-w-xl text-sm text-muted-foreground">{BLURB[t]}</p>
            <Button onClick={() => setAdding((v) => !v)} variant={adding ? "outline" : "default"} aria-expanded={adding} className="shrink-0">
              <Plus className={cn("transition-transform duration-200", adding && "rotate-45")} aria-hidden />
              {adding ? "Cancel" : `Add ${KIND_LABELS[TAB_KIND[t]].toLowerCase()}`}
            </Button>
          </div>
          <Collapse open={adding && tab === t}>
            <div className="mb-1">
              <AddDocument kind={TAB_KIND[t]} jobs={jobs} hasBase={hasBase} onDone={() => setAdding(false)} />
            </div>
          </Collapse>
          <DocumentTable rows={rows.filter((r) => r.kind === TAB_KIND[t])} emptyText={EMPTY[t]} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
