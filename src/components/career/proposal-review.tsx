"use client";

import { AlertTriangle, ArrowLeft, CheckCheck, FileText, Save, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  applyProposalAction,
  dismissProposalAction,
  regroupRoleAction,
  saveDecisionsAction,
} from "@/app/(app)/library/record/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { applyProposal, resolveDecisions, type ApplySummary } from "@/lib/career/apply";
import { acceptAll, setRoleBullets, updateDecision, type DecisionPatch } from "@/lib/career/decisions";
import type { Decisions, Proposal, RoleSuggestion } from "@/lib/career/proposal-schema";
import type { CareerRecord } from "@/lib/career/schema";
import type { OpenReview } from "@/lib/career/review";
import { EmployerCard } from "./review-employer";
import { ParagraphGroup } from "./review-paragraphs";
import { SimpleGroup } from "./review-simple";
import { SkipButton } from "./skip-button";

const KIND_LABEL = { resume: "Resume", cover_letter: "Cover letter", profile: "Profile", linkedin: "LinkedIn" } as const;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** A dry run of the merge, in words: what saving would add. */
function describe(s: ApplySummary): string {
  const parts = [
    s.employersAdded && plural(s.employersAdded, "new employer"),
    s.rolesAdded && plural(s.rolesAdded, "new role"),
    s.framingsAdded && plural(s.framingsAdded, "new framing"),
    s.factsAdded && plural(s.factsAdded, "new fact"),
    s.storiesAdded && plural(s.storiesAdded, "story", "stories"),
    s.wordingsAdded - s.factsAdded > 0 && plural(s.wordingsAdded - s.factsAdded, "new wording"),
    s.otherItemsAdded && plural(s.otherItemsAdded, "other item"),
  ].filter(Boolean);
  const known = s.alreadyKnown ? ` ${plural(s.alreadyKnown, "bullet")} already in your record only ${s.alreadyKnown === 1 ? "gains" : "gain"} this source.` : "";
  return parts.length ? `Saving adds ${parts.join(", ")}.${known}` : `Nothing new here.${known || " Saving only records where things came from."}`;
}

export function ProposalReview({
  review,
  record,
  done,
  total,
}: {
  review: OpenReview;
  record: CareerRecord;
  done: number;
  total: number;
}) {
  const router = useRouter();
  const { source } = review;
  const [proposal, setProposal] = useState<Proposal>(review.proposal);
  const [decisions, setDecisions] = useState<Decisions>(review.decisions);
  const [saving, startSave] = useTransition();
  const [skipping, startSkip] = useTransition();

  const resolved = useMemo(() => resolveDecisions(proposal, decisions, record), [proposal, decisions, record]);
  const summary = useMemo(() => {
    let n = 0;
    return applyProposal(record, resolved, { sourceId: source.id, label: source.label, newId: () => `preview${++n}` }, proposal.targetRole).summary;
  }, [record, resolved, source.id, source.label, proposal.targetRole]);

  // Choices are kept as they are made, so a reload loses nothing. The first render is what was loaded.
  const loaded = useRef(true);
  useEffect(() => {
    if (loaded.current) {
      loaded.current = false;
      return;
    }
    const t = setTimeout(() => {
      void saveDecisionsAction(review.proposalId, decisions).then((res) => {
        if (!res.ok) toast.error(res.error);
      });
    }, 600);
    return () => clearTimeout(t);
  }, [decisions, review.proposalId]);

  const decide = (key: string, patch: DecisionPatch) => setDecisions((d) => updateDecision(d, key, patch));

  async function regroup(roleKey: string, target: RoleSuggestion) {
    const res = await regroupRoleAction(review.proposalId, roleKey, target);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    // Keep the user's own choices (the server may not have them yet) and forget only those about the regrouped bullets.
    const item = res.proposal.employers.flatMap((e) => e.roles).find((r) => r.key === roleKey);
    const forgotten = new Set(item?.bullets.map((b) => b.key));
    setProposal(res.proposal);
    setDecisions((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !forgotten.has(k))));
  }

  function save() {
    startSave(async () => {
      const res = await applyProposalAction(review.proposalId, decisions);
      if (res.ok) {
        toast.success(`Saved as record version ${res.version}`);
      } else {
        toast.error(res.error);
      }
      router.refresh();
    });
  }

  function skip() {
    startSkip(async () => {
      const res = await dismissProposalAction(review.proposalId);
      if (res.ok) toast.success("Left out of your record");
      else toast.error(res.error);
      router.refresh();
    });
  }

  const empty =
    proposal.employers.length + proposal.skills.length + proposal.projects.length + proposal.education.length + proposal.certifications.length + proposal.achievements.length + proposal.paragraphs.length === 0;

  return (
    <div className="space-y-4">
      <Link
        href="/library?tab=record"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Career record
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 animate-in fade-in duration-300 motion-reduce:animate-none">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">
            Source {Math.min(done + 1, total)} of {total}
          </p>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <FileText className="size-4 text-muted-foreground" aria-hidden />
            {source.label}
            <Badge variant="outline">{KIND_LABEL[source.kind]}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {describe(summary)}
          </p>
          {review.note && <p className="text-xs text-muted-foreground">{review.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SkipButton proposalId={review.proposalId} ready size="default" />
          <Button variant="outline" onClick={skip} loading={skipping} disabled={saving}>
            <SkipForward aria-hidden />
            Leave this source out
          </Button>
          <Button variant="outline" onClick={() => setDecisions((d) => acceptAll(d, proposal))} disabled={saving || skipping}>
            <CheckCheck aria-hidden />
            Include everything
          </Button>
          <Button onClick={save} loading={saving} disabled={skipping}>
            <Save aria-hidden />
            Save to record
          </Button>
        </div>
      </div>

      {proposal.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {proposal.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-4">
          {empty && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing could be read from this source.</p>}
          {resolved.employers.map((e) => (
            <EmployerCard
              key={e.item.key}
              resolved={e}
              record={record}
              decide={decide}
              setRoleBullets={(roleKey, include) => setDecisions((d) => setRoleBullets(d, proposal, roleKey, include))}
              regroup={regroup}
            />
          ))}
          <SimpleGroup
            title="Skills"
            items={resolved.skills}
            decide={decide}
            label={(s) => s.name}
            detail={(s) => <p className="text-xs text-muted-foreground">{s.category}</p>}
          />
          <SimpleGroup
            title="Projects"
            items={resolved.projects}
            decide={decide}
            label={(p) => p.name}
            detail={(p) => (p.description || p.bullets.length > 0) && <p className="text-xs text-muted-foreground">{p.description || `${plural(p.bullets.length, "bullet")}`}</p>}
          />
          <SimpleGroup
            title="Education"
            items={resolved.education}
            decide={decide}
            label={(e) => e.institution}
            detail={(e) => <p className="text-xs text-muted-foreground">{[e.degree, e.field].filter(Boolean).join(" in ")}</p>}
          />
          <SimpleGroup
            title="Certifications"
            items={resolved.certifications}
            decide={decide}
            label={(c) => c.name}
            detail={(c) => c.issuer && <p className="text-xs text-muted-foreground">{c.issuer}</p>}
          />
          <SimpleGroup title="Achievements" items={resolved.achievements} decide={decide} label={(a) => a.text} />
          <ParagraphGroup items={resolved.paragraphs} record={record} decide={decide} />
        </div>

        <aside className="lg:sticky lg:top-16 lg:self-start">
          <h3 className="mb-2 text-sm font-medium">What the source says</h3>
          <ScrollArea className="h-[70vh] rounded-lg border">
            <pre className="whitespace-pre-wrap p-3 text-xs leading-relaxed">{source.text || "No text."}</pre>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
