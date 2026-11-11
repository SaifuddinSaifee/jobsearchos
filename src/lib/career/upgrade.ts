import { textKey } from "./normalize";
import type { CareerRecord, SourceRef } from "./schema";

// Reading a record saved under an older schema. Each version row keeps the schema it was saved with
// (`record_schema`), so old versions stay readable and can still be restored. Pure.

type Loose = Record<string, unknown>;

const list = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : []);

function addRef(to: SourceRef[], ref: SourceRef) {
  if (!to.some((r) => r.sourceId === ref.sourceId && r.blockId === ref.blockId)) to.push(ref);
}

/**
 * The record in the current shape. Schema 1 facts had only wordings: they get an empty statement and no details, their
 * sources are those of their wordings, and every wording's text is noted as seen. Roles get no technologies.
 */
export function upgradeRecord(record: unknown, schema: number): CareerRecord {
  if (schema >= 2) return record as CareerRecord;
  const next = structuredClone(record) as Loose;
  for (const employer of list(next.employers)) {
    for (const role of list(employer.roles)) {
      role.technologies ??= [];
      for (const fact of list(role.facts)) {
        const wordings = list(fact.wordings) as { text: string; sources: SourceRef[] }[];
        const sources: SourceRef[] = [];
        for (const w of wordings) for (const s of w.sources) addRef(sources, s);
        fact.statement ??= "";
        fact.details ??= [];
        fact.sources ??= sources;
        fact.seen ??= [...new Set(wordings.map((w) => textKey(w.text)))];
      }
    }
  }
  for (const project of list(next.projects)) {
    project.seen ??= [...new Set((list(project.wordings) as { text: string }[]).map((w) => textKey(w.text)))];
  }
  return next as CareerRecord;
}
