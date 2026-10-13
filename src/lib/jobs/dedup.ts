import { createHash } from "node:crypto";
import { normalizeForDedup } from "./normalize";

export { normalizeForDedup };

/** Hash of normalized company + title + location. */
export function dedupKey(job: { company: string; title: string; location: string }): string {
  const parts = [job.company, job.title, job.location].map(normalizeForDedup).join("|");
  return createHash("sha256").update(parts).digest("hex");
}
