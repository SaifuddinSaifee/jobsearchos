import type { RecordVersionReason } from "@/lib/career/schema";

export type RecordVersionItem = {
  id: string;
  version: number;
  reason: RecordVersionReason;
  changeNote: string | null;
  createdAt: string;
};

/** Counts shown in the Career record tab before the full browser exists. */
export type RecordSummary = {
  version: number;
  employers: number;
  roles: number;
  facts: number;
  wordings: number;
  skills: number;
};
