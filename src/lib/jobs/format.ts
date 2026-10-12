const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function compact(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "C$", AUD: "A$" };

const PERIODS: Record<string, string> = { year: "yr", month: "mo", hour: "hr" };

/** `$150k–$180k / yr`; "" when no pay is known. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string {
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo == null || hi == null) return "";
  const cur = currency ? (SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `) : "";
  const range = lo === hi ? `${cur}${compact(lo)}` : `${cur}${compact(lo)}–${cur}${compact(hi)}`;
  const per = period ? PERIODS[period] : undefined;
  return per ? `${range} / ${per}` : range;
}

/** Salary normalized to a year, for sorting. Uses the top of the range; null when unknown. */
export function annualSalary(
  min: number | null,
  max: number | null,
  period: string | null,
): number | null {
  const v = max ?? min;
  if (v == null) return null;
  if (period === "hour") return v * 2080;
  if (period === "month") return v * 12;
  return v;
}

/** `Jan 5, 2026`, from the UTC date parts so server and client render the same text. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function daysBetween(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export function relativeDays(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const d = daysBetween(iso, now);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/** The user's local calendar date as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A calendar date stored at 12:00 UTC so no timezone can shift it to another day. */
export function dateToStored(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function storedToDate(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}
