import type { Classifier } from "./cover";
import { roleChoices } from "./role-choices";
import { classifyBullet } from "./dedupe";
import type { Grouper } from "./group";
import type { BulletItem, EmployerItem, ParagraphItem, Proposal, RoleItem } from "./proposal-schema";
import type { CareerRecord, Role } from "./schema";

// Putting the model's answers into a proposal. Pure apart from the model call, which is injected.

/**
 * Settles the bullets of one role item against a role of the record: exact and near matches first (no model), then
 * the model for what is left. Returns the bullets with their new suggestions. Bullets the model does not place stay new.
 */
export async function groupRoleBullets(item: RoleItem, target: Role | null, grouper: Grouper): Promise<BulletItem[]> {
  const settled = item.bullets.map((b): BulletItem => ({ ...b, suggestion: classifyBullet(target, b) }));
  if (!target) return settled;
  const open = settled.filter((b) => b.suggestion.to === "new");
  if (open.length === 0) return settled;
  const answers = await grouper(target, open.map((b) => ({ key: b.key, text: b.text })));
  return settled.map((b) => {
    const a = b.suggestion.to === "new" ? answers.get(b.key) : undefined;
    if (!a) return b;
    if (a.factId) return { ...b, suggestion: { to: "fact", factId: a.factId, why: "model" } };
    if (a.withKey) return { ...b, suggestion: { to: "new", withKey: a.withKey } };
    return b;
  });
}

const roleOf = (record: CareerRecord, employer: EmployerItem, role: RoleItem): Role | null => {
  if (role.suggestion.to === "new" || employer.suggestion.to !== "existing") return null;
  const employerId = employer.suggestion.employerId;
  const roleId = role.suggestion.roleId;
  return record.employers.find((e) => e.id === employerId)?.roles.find((r) => r.id === roleId) ?? null;
};

/** Groups the unmatched bullets of every role that joins a role already in the record. */
export async function groupProposal(proposal: Proposal, record: CareerRecord, grouper: Grouper): Promise<Proposal> {
  const employers: EmployerItem[] = [];
  for (const e of proposal.employers) {
    const roles: RoleItem[] = [];
    for (const r of e.roles) {
      const target = roleOf(record, e, r);
      roles.push(target ? { ...r, bullets: await groupRoleBullets(r, target, grouper) } : r);
    }
    employers.push({ ...e, roles });
  }
  return { ...proposal, employers };
}

/**
 * Labels the paragraphs of a cover letter and settles each story against the facts of its role. A "why this
 * company" paragraph only keeps that label when the document says which company it was written for.
 */
export async function classifyProposalParagraphs(
  proposal: Proposal,
  record: CareerRecord,
  classify: Classifier,
  grouper: Grouper,
): Promise<Proposal> {
  if (proposal.paragraphs.length === 0) return proposal;
  const roles = roleChoices(record);
  const classes = await classify(
    proposal.paragraphs.map((p) => ({ key: p.key, text: p.text })),
    roles,
  );
  const known = new Map(record.employers.flatMap((e) => e.roles).map((r) => [r.id, r]));

  let paragraphs: ParagraphItem[] = proposal.paragraphs.map((p) => {
    const c = classes.get(p.key);
    if (!c) return p;
    const kind = c.kind === "motivation_company" && !p.companyName ? "motivation_general" : c.kind;
    const roleId = kind === "story" && c.roleId && known.has(c.roleId) ? c.roleId : null;
    return { ...p, suggestion: { kind, roleId, factId: null } };
  });

  // Each role's stories are compared with its facts, as bullets are.
  const byRole = new Map<string, ParagraphItem[]>();
  for (const p of paragraphs) {
    if (p.suggestion.kind === "story" && p.suggestion.roleId) byRole.set(p.suggestion.roleId, [...(byRole.get(p.suggestion.roleId) ?? []), p]);
  }
  const factFor = new Map<string, string>();
  for (const [roleId, stories] of byRole) {
    const role = known.get(roleId);
    if (!role) continue;
    const answers = await grouper(role, stories.map((p) => ({ key: p.key, text: p.text })));
    for (const [key, a] of answers) if (a.factId) factFor.set(key, a.factId);
  }
  paragraphs = paragraphs.map((p) => (factFor.has(p.key) ? { ...p, suggestion: { ...p.suggestion, factId: factFor.get(p.key)! } } : p));
  return { ...proposal, paragraphs };
}
