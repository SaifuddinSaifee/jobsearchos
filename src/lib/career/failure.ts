import type { SourceKind } from "./schema";

/**
 * A failed source's error, taken apart so it can be read. Errors from the model provider arrive as
 * "<what we were doing>: <HTTP status> <JSON body>"; anything else is kept as a plain message.
 */
export type FailureDetails = {
  /** What was being done when it failed, such as "Could not group bullets with the model". */
  step: string | null;
  /** The plain-language reason, the provider's own message when there is one. */
  message: string;
  status: number | null;
  type: string | null;
  code: string | null;
  param: string | null;
  requestId: string | null;
  raw: string;
};

export type FailedSource = {
  id: string;
  label: string;
  kind: SourceKind;
  error: string | null;
  attempts: number;
  /** ISO time it failed. */
  failedAt: string | null;
};

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  resume: "Resume",
  cover_letter: "Cover letter",
  profile: "Profile",
  linkedin: "LinkedIn",
};

const API_ERROR =/^(?:([\s\S]*?):\s+)?(\d{3})\s+(\{[\s\S]*)$/;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null;
}

/** Pulls one string field out of JSON that may have been cut short when it was stored. */
function field(text: string, name: string): string | null {
  const m = text.match(new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

export function parseFailure(raw: string | null): FailureDetails {
  const text = (raw ?? "").trim();
  const empty = { step: null, status: null, type: null, code: null, param: null, requestId: null, raw: text };
  if (!text) return { ...empty, message: "Unknown error" };

  const m = text.match(API_ERROR);
  if (!m) return { ...empty, message: text };

  const [, step, status, body] = m;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    // Stored errors are cut to 500 characters, so the JSON may be incomplete; fall back to reading fields by name.
  }
  const inner = parsed && typeof parsed.error === "object" && parsed.error ? (parsed.error as Record<string, unknown>) : parsed;
  const pick = (name: string) => (parsed ? (str(inner?.[name]) ?? str(parsed[name])) : field(body, name));

  return {
    step: step?.trim() || null,
    status: Number(status),
    message: (parsed ? (str(inner?.message) ?? (typeof parsed.error === "string" ? parsed.error : null)) : field(body, "message")) ?? body,
    type: pick("type"),
    code: pick("code"),
    param: pick("param"),
    requestId: parsed ? (str(parsed.id) ?? str(parsed.request_id) ?? str(inner?.id)) : (field(body, "id") ?? field(body, "request_id")),
    raw: text,
  };
}

/** The labelled lines shown for a failure, in reading order. Empty fields are left out. */
export function failureFields(f: FailedSource, d: FailureDetails = parseFailure(f.error)): [string, string][] {
  const rows: [string, string | null][] = [
    ["Source", f.label],
    ["Kind", SOURCE_KIND_LABEL[f.kind]],
    ["Failed at", f.failedAt ? new Date(f.failedAt).toLocaleString() : null],
    ["Attempts", String(f.attempts)],
    ["Step", d.step],
    ["HTTP status", d.status === null ? null : String(d.status)],
    ["Error type", d.type],
    ["Error code", d.code],
    ["Parameter", d.param],
    ["Request id", d.requestId],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

/** Plain text for the clipboard: each failure's fields, its message and the raw error, separated by a blank line. */
export function failureReport(failures: FailedSource[]): string {
  return failures
    .map((f) => {
      const d = parseFailure(f.error);
      const lines = failureFields(f, d).map(([k, v]) => `${k}: ${v}`);
      lines.push(`Message: ${d.message}`);
      if (d.raw && d.raw !== d.message) lines.push(`Raw error: ${d.raw}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
