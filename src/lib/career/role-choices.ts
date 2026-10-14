import { formatDates } from "./dates";
import type { CareerRecord } from "./schema";

// The roles of the record as short labelled choices, for the model and for the pickers in the review. Client-safe.

export type RoleChoice = { id: string; label: string };

/** Roles shown to the model, most recent first, so a long career stays within the prompt. */
export const MAX_ROLES_SHOWN = 40;

/** Every role of the record as a short line the model can choose, newest first. */
export function roleChoices(record: CareerRecord, limit = MAX_ROLES_SHOWN): RoleChoice[] {
  const rows = record.employers.flatMap((e) =>
    e.roles.map((r) => ({
      id: r.id,
      label: `${e.name}: ${r.framings.map((f) => f.title).join(" / ") || "Role"}, ${formatDates(r) || "no dates"}`,
      recent: r.current ? Number.MAX_SAFE_INTEGER : Number((r.end.match(/\d{4}/) ?? r.start.match(/\d{4}/) ?? [0])[0]),
    })),
  );
  return rows.sort((a, b) => b.recent - a.recent).slice(0, limit).map(({ id, label }) => ({ id, label }));
}

