"use client";

import { ChevronLeft, Globe, Loader2, Merge, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  mergeCompaniesAction,
  researchCompanyAction,
  updateCompanyAction,
} from "@/app/(app)/companies/actions";
import { MarkdownButtons } from "@/components/jobs/markdown-actions";
import { TagsField } from "@/components/profile/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { companyFilename, companyToMarkdown } from "@/lib/companies/markdown";
import { COMPANY_FIELDS, MAX_FIELD_CHARS, type CompanyDetail, type CompanyField } from "@/lib/companies/types";
import { formatDate } from "@/lib/jobs/format";
import { safeHref } from "@/lib/jobs/links";
import { statusInfo } from "@/lib/jobs/status";

const PROVENANCE: Record<string, { label: string; tone: string }> = {
  posting: { label: "From a job posting", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  web: { label: "Web research: check it", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  user: { label: "Edited by you", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

type Others = { id: string; name: string }[];

function MergeDialog({ company, others }: { company: CompanyDetail; others: Others }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const targetName = others.find((o) => o.id === target)?.name;

  async function merge() {
    setBusy(true);
    const res = await mergeCompaniesAction(company.id, target);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(`Merged into ${targetName}`);
    router.push(`/companies/${target}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={others.length === 0} />}>
        <Merge /> Merge into…
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge {company.name} into another company</DialogTitle>
          <DialogDescription>
            Use this for duplicates (e.g. &quot;Google LLC&quot; and &quot;Google&quot;). All {company.jobs.length} job
            {company.jobs.length === 1 ? "" : "s"} move over, &quot;{company.name}&quot; becomes an alias, and empty fields are filled from this
            profile. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Company to merge into"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Choose a company…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button onClick={() => void merge()} disabled={!target || busy} variant="destructive">
          {busy && <Loader2 className="animate-spin" />}
          Merge{targetName ? ` into ${targetName}` : ""}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyEditor({ company, others }: { company: CompanyDetail; others: Others }) {
  const router = useRouter();
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website);
  const [fields, setFields] = useState<Record<CompanyField, string>>({
    about: company.about,
    principles: company.principles,
    culture: company.culture,
  });
  const [notes, setNotes] = useState(company.notes);
  const [aliases, setAliases] = useState(company.aliases);
  const [saving, setSaving] = useState(false);
  const [researching, setResearching] = useState(false);

  const dirty =
    name !== company.name ||
    website !== company.website ||
    notes !== company.notes ||
    COMPANY_FIELDS.some((f) => fields[f.key] !== company[f.key]) ||
    aliases.join("\n") !== company.aliases.join("\n");

  async function save() {
    setSaving(true);
    const res = await updateCompanyAction(company.id, { name, website, notes, aliases, ...fields });
    setSaving(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Company saved");
    router.refresh();
  }

  async function research() {
    setResearching(true);
    const res = await researchCompanyAction(company.id);
    setResearching(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(
      res.applied.length
        ? `Updated ${res.applied.length} section${res.applied.length === 1 ? "" : "s"} from ${res.via === "web-search" ? "a web search" : "the company's own site"}`
        : "Nothing to update: every section is either empty on the web or edited by you",
    );
    router.refresh();
  }

  const site = safeHref(website);
  const markdown = () => ({
    markdown: companyToMarkdown({ name, website, ...fields, notes, sources: company.sources }),
    filename: companyFilename(name),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Link href="/companies" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ChevronLeft className="size-4" aria-hidden />
            Companies
          </Link>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Company name"
            className="h-10 max-w-md text-xl font-semibold"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save changes
          </Button>
          <Button
            variant="outline"
            onClick={() => void research()}
            disabled={researching || dirty}
            title={dirty ? "Save your changes first" : "Reads the company's own site first; searches the web only if that is not enough. Skips sections you edited."}
          >
            {researching ? <Loader2 className="animate-spin" /> : <Globe />}
            {company.researchedAt ? "Refresh from web" : "Research on the web"}
          </Button>
          <MergeDialog company={company} others={others} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MarkdownButtons build={markdown} />
        <p className="text-xs text-muted-foreground">
          {company.researchedAt ? `Last researched ${formatDate(company.researchedAt)}. ` : "Not researched yet. "}
          Research never overwrites sections you edited.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <div className="flex items-center gap-2">
            <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline">
                Open
              </a>
            )}
          </div>
        </div>
        <TagsField
          label="Also known as"
          value={aliases}
          onChange={setAliases}
          placeholder="YouTube, Google LLC"
          hint="Other names that should link to this company. Separate with commas."
        />
      </div>

      {COMPANY_FIELDS.map((f) => {
        const prov = PROVENANCE[company.provenance[f.key] ?? ""];
        return (
          <div key={f.key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor={f.key}>{f.label}</Label>
              {prov && fields[f.key] === company[f.key] && <Badge className={prov.tone}>{prov.label}</Badge>}
              {fields[f.key] !== company[f.key] && <Badge variant="outline">Unsaved</Badge>}
            </div>
            <Textarea
              id={f.key}
              rows={f.key === "principles" ? 12 : 7}
              value={fields[f.key]}
              maxLength={MAX_FIELD_CHARS}
              onChange={(e) => setFields((s) => ({ ...s, [f.key]: e.target.value }))}
              placeholder="Markdown supported"
            />
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        );
      })}

      <div className="space-y-1.5">
        <Label htmlFor="notes">My notes about the company</Label>
        <Textarea
          id="notes"
          rows={5}
          value={notes}
          maxLength={MAX_FIELD_CHARS}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why you want to work here, people you know, things to mention in a cover letter…"
        />
        <p className="text-xs text-muted-foreground">Included in Markdown exports so you can hand it to Claude with the job.</p>
      </div>

      {company.sources.length > 0 && (
        <section className="space-y-1.5">
          <h2 className="text-sm font-medium">Sources used for research</h2>
          <ul className="space-y-1 text-sm">
            {company.sources.map((s) => (
              <li key={s.url}>
                <a href={safeHref(s.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Jobs at {company.name}</h2>
        {company.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {company.jobs.map((j) => (
              <li key={j.jobId} className="flex items-center justify-between gap-3 px-3 py-2">
                <Link href={`/jobs?job=${j.jobId}`} className="truncate hover:underline">
                  {j.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {statusInfo(j.status).label} · saved {formatDate(j.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
