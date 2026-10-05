import type { ColdEmailSettings } from "@/lib/email/settings-schema";
import type { EmailStatus } from "./types";

// Pure (no database import): the composer runs these on every keystroke, and the server runs them again before sending.

export type Check = { level: "error" | "warn"; code: string; message: string };

/** From docs/cold-email.md. Matched case-insensitively. */
export const BANNED_PHRASES = [
  "I hope this finds you well",
  "My name is",
  "I am writing to",
  "I came across",
  "reaching out",
  "I'd love to connect",
  "Worth a quick chat",
  "perfect fit",
  "I'm a huge fan",
  "passionate",
  "excited",
  "thrilled",
  "I believe",
  "aligns with",
  "leverage",
  "fast-paced",
  "make an impact",
  "end to end",
  "I am confident that",
  "I know you're busy",
  "pick your brain",
  "Looking forward",
  "I look forward to hearing from you",
  "just checking in",
  "bumping this",
  "circling back",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function findBanned(text: string, extra: string[] = []): string[] {
  return [...BANNED_PHRASES, ...extra].filter((p) => new RegExp(`(?<![\\w])${escape(p.replace(/\u2019/g, "'"))}(?![\\w])`, "i").test(text.replace(/\u2019/g, "'")));
}

export function findPlaceholders(text: string): string[] {
  return [...text.matchAll(/\[[^\]\n]{1,80}\]/g)].map((m) => m[0]);
}

/** Errors block sending; warnings are advice the writer can overrule. */
export function checkEmail(input: { subject: string; body: string }, s: ColdEmailSettings): Check[] {
  const out: Check[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();

  if (!subject) out.push({ level: "error", code: "no_subject", message: "Add a subject." });
  if (!body) out.push({ level: "error", code: "no_body", message: "Write the email." });

  const placeholders = findPlaceholders(`${subject}\n${body}`);
  if (placeholders.length > 0) {
    out.push({ level: "error", code: "placeholder", message: `Fill in ${placeholders.slice(0, 3).join(", ")}${placeholders.length > 3 ? " and more" : ""} before sending.` });
  }

  if (body) {
    const words = wordCount(body);
    if (words < s.minWords) out.push({ level: "warn", code: "short", message: `${words} words. Your minimum is ${s.minWords}.` });
    if (words > s.maxWords) out.push({ level: "warn", code: "long", message: `${words} words. Your maximum is ${s.maxWords}. Shorter emails get more replies.` });
  }

  const banned = findBanned(`${subject}\n${body}`, s.extraBannedPhrases);
  if (banned.length > 0) out.push({ level: "warn", code: "banned", message: `Template phrases: ${banned.slice(0, 4).map((b) => `"${b}"`).join(", ")}.` });

  if (/[—–]/.test(`${subject}${body}`)) out.push({ level: "warn", code: "dash", message: "Contains a long dash, a common sign of machine-written text." });
  if (/^\s*([-*]|\d+[.)])\s+/m.test(body)) out.push({ level: "warn", code: "bullets", message: "Bullet lists read like a template. Use plain sentences." });

  const links = body.match(/https?:\/\/\S+|\b(?:linkedin|github)\.com\/\S+/gi) ?? [];
  if (links.length > 2) out.push({ level: "warn", code: "links", message: `${links.length} links. Keep it to two at most.` });

  const subjectWords = wordCount(subject);
  if (subject && subjectWords > 8) out.push({ level: "warn", code: "subject_long", message: `Subject is ${subjectWords} words. 2 to 6 works best.` });

  return out;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Advice when "now" falls outside the configured send days and window, in the local time zone of the machine. */
export function sendTimingWarning(s: ColdEmailSettings, now: Date): string | null {
  const day = DAYS[now.getDay()];
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const dayOk = s.sendDays.includes(day);
  const timeOk = hhmm >= s.sendWindowStart && hhmm <= s.sendWindowEnd;
  if (dayOk && timeOk) return null;
  const days = DAYS.slice(1).concat(DAYS[0]).filter((d) => s.sendDays.includes(d)).map((d) => d[0].toUpperCase() + d.slice(1)).join(", ");
  return `Outside your usual send time (${days}, ${s.sendWindowStart} to ${s.sendWindowEnd}). Emails sent in the recipient's morning get read more often.`;
}

const GENERIC_LOCALPARTS = /^(info|careers?|jobs?|hr|hello|contact|support|admin|team|talent|recruiting|recruitment|hiring|apply|applications?|press|sales|office|mail|enquiries|inquiries)$/i;

export function isGenericInbox(email: string): boolean {
  return GENERIC_LOCALPARTS.test(email.split("@")[0] ?? "");
}

export type SendWarning = { code: "unverified" | "duplicate" | "timing"; message: string };

/**
 * Things worth a second look before sending that the user may still choose to do. The composer shows them in the
 * confirm dialog; the server checks that each one was acknowledged, so a stale or hand-made request cannot skip them.
 */
export function sendWarnings(
  to: { name: string; emailStatus: EmailStatus; sentCount: number },
  s: ColdEmailSettings,
  now: Date,
): SendWarning[] {
  const out: SendWarning[] = [];
  if (to.emailStatus === "risky") {
    out.push({ code: "unverified", message: "This address could not be confirmed (the mail server accepts anything). It may bounce." });
  } else if (to.emailStatus === "unverified" && s.requireVerifiedAddress) {
    out.push({ code: "unverified", message: "This address is not verified, and your settings ask for verified addresses. It may bounce and hurt your sender reputation." });
  }
  if (to.sentCount > 0) {
    out.push({ code: "duplicate", message: `You already emailed ${to.name} about this job${to.sentCount > 1 ? ` (${to.sentCount} times)` : ""}.` });
  }
  const timing = sendTimingWarning(s, now);
  if (timing) out.push({ code: "timing", message: timing });
  return out;
}
