import { mergeDates } from "./dates";
import { normalizeText } from "./normalize";
import type { Proposal } from "./proposal-schema";
import type { CareerRecord } from "./schema";

/**
 * Whether merging this proposal would add nothing to the record: every employer, role, bullet and other item is
 * already there, the dates and location would not change, and the role it was written for is already noted. Such a
 * source is left out without asking, since saving it would only record where things were read. Pure.
 */
export function isNothingNew(proposal: Proposal, record: CareerRecord): boolean {
  // A source that gave nothing at all is not "nothing new": the user should be told that nothing could be read.
  const read = proposal.employers.length + proposal.skills.length + proposal.projects.length + proposal.education.length + proposal.certifications.length + proposal.achievements.length + proposal.paragraphs.length;
  if (read === 0) return false;
  if (proposal.paragraphs.some((p) => p.suggestion.kind !== "boilerplate" && !p.removedBefore)) return false;
  const simple = [proposal.skills, proposal.projects, proposal.education, proposal.certifications, proposal.achievements];
  for (const list of simple) {
    if (list.some((i) => !i.removedBefore && i.suggestion.to !== "existing")) return false;
  }

  for (const e of proposal.employers) {
    if (e.removedBefore) continue;
    if (e.suggestion.to !== "existing") return false;
    const employerId = e.suggestion.employerId;
    const employer = record.employers.find((x) => x.id === employerId);
    if (!employer) return false;
    for (const r of e.roles) {
      if (r.removedBefore) continue;
      if (r.suggestion.to !== "same") return false;
      const roleId = r.suggestion.roleId;
      const role = employer.roles.find((x) => x.id === roleId);
      if (!role) return false;
      if (r.bullets.some((b) => !b.removedBefore && b.suggestion.to !== "known")) return false;

      const merged = mergeDates({ start: role.start, end: role.end, current: role.current }, { start: r.start, end: r.end, current: r.current });
      if (merged.dates.start !== role.start || merged.dates.end !== role.end || merged.dates.current !== role.current || merged.conflict) return false;
      if (!role.location && r.location) return false;

      const framingId = r.suggestion.framingId;
      const framing = role.framings.find((f) => f.id === framingId);
      if (!framing) return false;
      if (proposal.targetRole && !framing.targetRoles.some((t) => normalizeText(t) === normalizeText(proposal.targetRole!))) return false;
    }
  }
  return true;
}
