"use client";

import { Globe, Merge, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  deleteCompanyAction,
  mergeCompaniesAction,
  researchCompanyAction,
  updateCompanyAction,
} from "@/app/(app)/companies/actions";
import { restoreDeletedAction } from "@/app/(app)/jobs/actions";
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
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { companyFilename, companyToMarkdown } from "@/lib/companies/markdown";
import type { CompanyResearchLog } from "@/lib/companies/types";
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

function KindBadge({ kind }: { kind: "owned" | "third-party" }) {
  return kind === "owned" ? (
    <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Company-owned</Badge>
  ) : (
    <Badge variant="outline">Third-party</Badge>
  );
}

/** What the last research run looked at, so a weak result can be traced to its sources. */
export function ResearchLog({ log }: { log: CompanyResearchLog }) {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="font-medium hover:text-foreground">How this was researched</summary>
      <div className="mt-2 space-y-2">
        <p className="text-muted-foreground">
          {log.via === "web-search"
            ? `Used ${log.queries.length} web search${log.queries.length === 1 ? "" : "es"}.`
            : "Read the company's own site; no web search was used."}{" "}
          Mission, values and culture are only taken from company-owned pages.
        </p>
        {log.queries.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5">
            {log.queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        )}
        <ul className="space-y-1">
          {log.pages.map((p) => (
            <li key={p.url} className="flex items-center gap-2">
              <span className="min-w-0 truncate">{p.title}</span>
              <KindBadge kind={p.kind} />
              <span className="shrink-0 text-xs text-muted-foreground">{p.origin === "site" ? "company site" : "search"}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

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
        <NativeSelect
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Company to merge into"
        >
          <option value="">Choose a company…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
        <Button onClick={() => void merge()} disabled={!target} loading={busy} variant="destructive">
          Merge{targetName ? ` into ${targetName}` : ""}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ company }: { company: CompanyDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const count = company.jobs.length;

  async function remove() {
    setBusy(true);
    const res = await deleteCompanyAction(company.id);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    setOpen(false);
    router.push("/companies");
    toast(`Deleted ${company.name}`, {
      description: count ? `${count} job${count === 1 ? " was" : "s were"} deleted with it.` : undefined,
      duration: 8000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreDeletedAction(res.deleted);
          if (!undo.ok) return void toast.error(undo.error);
          router.refresh();
          toast.success(
            undo.skipped
              ? `Restored. ${undo.skipped} job${undo.skipped === 1 ? " was" : "s were"} saved again in the meantime and left as is.`
              : "Restored",
          );
        },
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="destructive" size="sm" />}>
        <Trash2 /> Delete
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {company.name}?</DialogTitle>
          <DialogDescription>
            {count
              ? `Its ${count} job${count === 1 ? "" : "s"} will be deleted too. `
              : "It has no jobs. "}
            {company.children.length > 0 && "Companies that are part of it become independent. "}
            You can undo this right after. Adding a job here again later creates a fresh entry.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void remove()} loading={busy}>
            <Trash2 />
            Delete{count ? ` company and ${count} job${count === 1 ? "" : "s"}` : " company"}
          </Button>
        </div>
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
  const [parentId, setParentId] = useState(company.parentId ?? "");
  const [saving, setSaving] = useState(false);
  const [researching, setResearching] = useState(false);

  const dirty =
    name !== company.name ||
    website !== company.website ||
    notes !== company.notes ||
    COMPANY_FIELDS.some((f) => fields[f.key] !== company[f.key]) ||
    aliases.join("\n") !== company.aliases.join("\n") ||
    parentId !== (company.parentId ?? "");

  async function save() {
    setSaving(true);
    const res = await updateCompanyAction(company.id, { name, website, notes, aliases, parentId: parentId || null, ...fields });
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
    markdown: companyToMarkdown({ name, website, ...fields, notes, sources: company.sources, parent: company.parent }),
    filename: companyFilename(name),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Company name"
            className="h-10 max-w-md text-xl font-semibold"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={!dirty} loading={saving}>
            <Save />
            Save changes
          </Button>
          <Button
            variant="outline"
            onClick={() => void research()}
            disabled={dirty}
            loading={researching}
            title={dirty ? "Save your changes first" : "Reads the company's own site first; searches the web only if that is not enough. Skips sections you edited."}
          >
            <Globe />
            {company.researchedAt ? "Refresh from web" : "Research on the web"}
          </Button>
          <MergeDialog company={company} others={others} />
          <DeleteDialog company={company} />
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="parent">Part of</Label>
          <NativeSelect
            id="parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">Independent company</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            For brands and subsidiaries (YouTube is part of Google). The parent&apos;s profile is added to your exports.
          </p>
        </div>
        {company.children.length > 0 && (
          <div className="space-y-1.5">
            <Label>Brands and subsidiaries</Label>
            <ul className="flex flex-wrap gap-2 text-sm">
              {company.children.map((c) => (
                <li key={c.id}>
                  <Link href={`/companies/${c.id}`} className="underline underline-offset-2">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
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
              <li key={s.url} className="flex items-center gap-2">
                <a href={safeHref(s.url) ?? "#"} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  {s.title}
                </a>
                {s.kind && <KindBadge kind={s.kind} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {company.researchLog && <ResearchLog log={company.researchLog} />}

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
