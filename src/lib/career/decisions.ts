import type {
  BulletSuggestion,
  ParagraphChoice,
  Decision,
  Decisions,
  EmployerSuggestion,
  Proposal,
  RoleSuggestion,
  SimpleSuggestion,
} from "./proposal-schema";

// Small pure helpers the review screen uses to change the user's choices. Client-safe.

export type DecisionPatch = {
  /** true to include the item, false to leave it out. Left undefined, the item keeps what it had. */
  include?: boolean;
  employer?: EmployerSuggestion;
  role?: RoleSuggestion;
  bullet?: BulletSuggestion;
  simple?: SimpleSuggestion;
  paragraph?: ParagraphChoice;
  angle?: string;
};

const CHANGE_FIELDS = ["employer", "role", "bullet", "simple", "paragraph", "angle"] as const;

/** The decisions after applying `patch` to one item. A decision with nothing in it is removed. */
export function updateDecision(decisions: Decisions, key: string, patch: DecisionPatch): Decisions {
  const prev: Decision | undefined = decisions[key];
  const { include, ...changes } = patch;
  const merged: Decision = { ...prev, ...changes, action: "accept" };
  const left = include === undefined ? prev?.action === "reject" : !include;
  const hasChange = CHANGE_FIELDS.some((f) => merged[f] !== undefined);
  merged.action = left ? "reject" : hasChange ? "change" : "accept";
  const next = { ...decisions };
  // An explicit "include" is kept, because for something the user removed before, no entry means "left out".
  // Nothing chosen and nothing changed means "as suggested", which is no entry at all.
  if (!left && !hasChange && include === undefined) delete next[key];
  else next[key] = merged;
  return next;
}

/** Every item key in a proposal. */
export function allKeys(proposal: Proposal): string[] {
  const keys: string[] = [];
  for (const e of proposal.employers) {
    keys.push(e.key);
    for (const r of e.roles) {
      keys.push(r.key);
      for (const b of r.bullets) keys.push(b.key);
    }
  }
  for (const list of [proposal.skills, proposal.projects, proposal.education, proposal.certifications, proposal.achievements, proposal.paragraphs]) {
    for (const item of list) keys.push(item.key);
  }
  return keys;
}

/** Includes every item (also those the user removed before), keeping any change already made to them. */
export function acceptAll(decisions: Decisions, proposal: Proposal): Decisions {
  return allKeys(proposal).reduce((acc, key) => updateDecision(acc, key, { include: true }), decisions);
}

/** Includes or leaves out one role and all of its bullets. */
export function setRoleBullets(decisions: Decisions, proposal: Proposal, roleKey: string, include: boolean): Decisions {
  const role = proposal.employers.flatMap((e) => e.roles).find((r) => r.key === roleKey);
  if (!role) return decisions;
  return role.bullets.reduce((acc, b) => updateDecision(acc, b.key, { include }), decisions);
}
