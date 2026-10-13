import type { Role, Wording } from "./schema";

/**
 * Whether a wording can be used under a framing of a role: it was written for that framing, or a source that told
 * the role under that framing also used it (the same text appears in both versions of a resume). Wordings with no
 * framing at all fit every framing. Client-safe.
 */
export function wordingFitsFraming(role: Role, wording: Wording, framingId: string): boolean {
  if (wording.framingId === framingId || wording.framingId === null) return true;
  const framing = role.framings.find((f) => f.id === framingId);
  if (!framing) return false;
  const told = new Set(framing.sources.map((s) => s.sourceId));
  return wording.sources.some((s) => told.has(s.sourceId));
}

/** The wordings of a role that can be used under one framing, in the order the facts are listed. */
export function wordingsForFraming(role: Role, framingId: string): Wording[] {
  return role.facts.flatMap((f) => f.wordings).filter((w) => wordingFitsFraming(role, w, framingId));
}
