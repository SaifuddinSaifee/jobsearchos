const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const formatCount = (n: number): string => count.format(n);

/** 1,284 stays 1,284 from 1,000 up to 9,999; beyond that 12.9K, 4.2M. */
export const formatTokens = (n: number): string => (n < 10_000 ? count.format(Math.round(n)) : compact.format(n));

/** Model calls here cost fractions of a cent, so small amounts keep four decimals instead of rounding to $0.00. */
export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const formatPercent = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "-");

/** "2026-10-14" as "Oct 14". The string is a calendar day already in the page's time zone, so it is not shifted. */
export const formatDay = (date: string): string => day.format(new Date(`${date}T00:00:00Z`));

/** A moment in the server's own time zone, which for this local app is the user's. */
export const formatStamp = (iso: string): string => stamp.format(new Date(iso));

/** Round axis ticks: about `target` of them, at 1, 2, 2.5 or 5 times a power of ten, topping the data. */
export function niceTicks(max: number, target = 4): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 0.25 };
  const raw = max / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return { top: Math.round(Math.ceil(max / step - 1e-9) * step * 1e10) / 1e10, step };
}

/** Axis tick text: only as many decimals as the tick spacing needs ($1, $0.50, $0.0025). */
export function formatAxisUsd(value: number, step: number): string {
  if (value === 0) return "$0";
  if (Number.isInteger(step)) return `$${value.toFixed(0)}`;
  const decimals = Math.min(4, Math.max(2, (String(step).split(".")[1] ?? "").length));
  return `$${value.toFixed(decimals)}`;
}
