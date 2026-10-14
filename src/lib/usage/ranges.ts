/** Ranges the usage page offers, in days (today included). Kept apart from metrics.ts so client components can use it. */
export const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type UsageRange = keyof typeof RANGE_DAYS;
export const USAGE_RANGES = ["7d", "30d", "90d"] as const satisfies readonly UsageRange[];
export const DEFAULT_RANGE: UsageRange = "30d";

export function parseRange(value: unknown): UsageRange {
  return typeof value === "string" && value in RANGE_DAYS ? (value as UsageRange) : DEFAULT_RANGE;
}
