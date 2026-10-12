export const STATUSES = [
  { value: "saved", label: "Saved", group: "active", tone: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  { value: "preparing", label: "Preparing", group: "active", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { value: "applied", label: "Applied", group: "applied", tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  { value: "recruiter_screen", label: "Recruiter screen", group: "interviews", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { value: "interview", label: "Interview", group: "interviews", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { value: "technical_interview", label: "Technical interview", group: "interviews", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { value: "final_interview", label: "Final interview", group: "interviews", tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  { value: "offer", label: "Offer", group: "offers", tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  { value: "rejected", label: "Rejected", group: "closed", tone: "bg-red-500/15 text-red-700 dark:text-red-300" },
  { value: "withdrawn", label: "Withdrawn", group: "closed", tone: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
  { value: "ghosted", label: "Ghosted", group: "closed", tone: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300" },
] as const;

export type ApplicationStatus = (typeof STATUSES)[number]["value"];
export type StatusGroup = (typeof STATUSES)[number]["group"];

export const STATUS_VALUES = STATUSES.map((s) => s.value) as [ApplicationStatus, ...ApplicationStatus[]];

const BY_VALUE = new Map<string, (typeof STATUSES)[number]>(STATUSES.map((s) => [s.value, s]));

export function statusInfo(status: string) {
  return BY_VALUE.get(status) ?? STATUSES[0];
}

/** Position in the pipeline; used for sorting by stage instead of alphabetically. */
export function statusRank(status: string): number {
  const i = STATUSES.findIndex((s) => s.value === status);
  return i === -1 ? STATUSES.length : i;
}

export function isClosed(status: string): boolean {
  return statusInfo(status).group === "closed";
}

export const TABS = [
  { value: "active", label: "Active", statuses: STATUSES.filter((s) => s.group !== "closed").map((s) => s.value) as ApplicationStatus[] },
  { value: "saved", label: "Saved", statuses: ["saved"] as ApplicationStatus[] },
  { value: "preparing", label: "Preparing", statuses: ["preparing"] as ApplicationStatus[] },
  { value: "applied", label: "Applied", statuses: ["applied"] as ApplicationStatus[] },
  { value: "interviews", label: "Interviews", statuses: STATUSES.filter((s) => s.group === "interviews").map((s) => s.value) as ApplicationStatus[] },
  { value: "offers", label: "Offers", statuses: ["offer"] as ApplicationStatus[] },
  { value: "closed", label: "Closed", statuses: STATUSES.filter((s) => s.group === "closed").map((s) => s.value) as ApplicationStatus[] },
] as const;

export type TabValue = (typeof TABS)[number]["value"];
export const TAB_VALUES = TABS.map((t) => t.value) as [TabValue, ...TabValue[]];

export function tabStatuses(tab: TabValue): readonly ApplicationStatus[] {
  return TABS.find((t) => t.value === tab)!.statuses;
}

export function tabCounts(rows: { status: string }[]): Record<TabValue, number> {
  const counts = Object.fromEntries(TABS.map((t) => [t.value, 0])) as Record<TabValue, number>;
  for (const r of rows) {
    for (const t of TABS) if ((t.statuses as readonly string[]).includes(r.status)) counts[t.value]++;
  }
  return counts;
}

export const STALE_APPLIED_DAYS = 7;
export const STALE_PREPARING_DAYS = 3;
