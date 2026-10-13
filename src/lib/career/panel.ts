import { cleanDatesText } from "./dates";
import { parseDates } from "@/lib/documents/convert/doc-to-profile";
import { wordingFitsFraming } from "./framing";
import { matchEmployer, matchRole } from "./match";
import { normalizeTitle } from "./normalize";
import type { CareerRecord, Role } from "./schema";

// What the editor's side panel shows for the role under the cursor: the role of the record it matches, and its
// facts with their wordings. Pure, so the route and the tests share it.

export type PanelQuery = {
  /** The career sources made from this document, whose block ids can be matched exactly. */
  documentSourceIds: string[];
  /** The id of the role block under the cursor. */
  roleBlockId: string | null;
  company: string;
  title: string;
  dates: string;
};

export type PanelWording = {
  id: string;
  text: string;
  form: "bullet" | "paragraph";
  /** The angle or title of the framing it was written for, when the role has more than one. */
  framing: string;
  /** Whether it can be used under the framing the page shows (all of them when no framing could be matched). */
  fits: boolean;
};

export type PanelRole = {
  roleId: string;
  employer: string;
  /** "same block" when this exact role was read from this document, "same text" when matched by employer, title and dates. */
  how: "block" | "text";
  title: string;
  dates: string;
  framings: { id: string; title: string; angle: string }[];
  matchedFramingId: string | null;
  facts: { id: string; wordings: PanelWording[] }[];
};

function roleByBlock(record: CareerRecord, q: PanelQuery) {
  if (!q.roleBlockId || q.documentSourceIds.length === 0) return null;
  const ids = new Set(q.documentSourceIds);
  for (const employer of record.employers) {
    const role = employer.roles.find((r) => r.sources.some((s) => ids.has(s.sourceId) && s.blockId === q.roleBlockId));
    if (role) return { employer, role };
  }
  return null;
}

function toPanel(employerName: string, role: Role, how: PanelRole["how"], q: PanelQuery, matchedFramingId: string | null): PanelRole {
  const multiple = role.framings.length > 1;
  const framingName = (id: string | null) => {
    const f = role.framings.find((x) => x.id === id);
    return multiple && f ? f.angle || f.title : "";
  };
  const facts = role.facts
    .map((f) => ({
      id: f.id,
      wordings: f.wordings.map((w) => ({
        id: w.id,
        text: w.text,
        form: w.form,
        framing: framingName(w.framingId),
        fits: matchedFramingId ? wordingFitsFraming(role, w, matchedFramingId) : true,
      })),
    }))
    // Facts that can be used under this framing first, then the rest, each in the order the record has them.
    .sort((a, b) => Number(b.wordings.some((w) => w.fits)) - Number(a.wordings.some((w) => w.fits)));
  return {
    roleId: role.id,
    employer: employerName,
    how,
    title: role.framings.find((f) => f.id === matchedFramingId)?.title ?? role.framings[0]?.title ?? q.title,
    dates: [role.start, role.current ? "Present" : role.end].filter(Boolean).join(" - "),
    framings: role.framings.map((f) => ({ id: f.id, title: f.title, angle: f.angle })),
    matchedFramingId,
    facts,
  };
}

/** The role of the record that the role under the cursor is: read from this very block, or the same by employer, title and dates. */
export function findPanelRole(record: CareerRecord, q: PanelQuery, now: Date = new Date()): PanelRole | null {
  const title = q.title.trim();
  const byTitle = (role: Role) => role.framings.find((f) => normalizeTitle(f.title) === normalizeTitle(title))?.id ?? null;

  const block = roleByBlock(record, q);
  if (block) return toPanel(block.employer.name, block.role, "block", q, byTitle(block.role));

  const employer = matchEmployer(record.employers, q.company, null);
  if (!employer || !title) return null;
  const { start, end, current } = parseDates(cleanDatesText(q.dates));
  const { match } = matchRole(employer, { title, start, end, current }, now);
  if (match.kind === "same") return toPanel(employer.name, match.role, "text", q, match.framing?.id ?? byTitle(match.role));
  // Another title for the same period is a role of the record too, just with a framing this page does not have yet.
  if (match.kind === "framing") return toPanel(employer.name, match.role, "text", q, null);
  return null;
}
