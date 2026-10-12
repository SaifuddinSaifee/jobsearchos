import { describe, expect, it } from "vitest";
import { defaultColdEmailSettings } from "@/lib/email/settings-schema";
import { checkEmail, findBanned, isGenericInbox, sendTimingWarning, sendWarnings, wordCount } from "@/lib/outreach/checks";
import { suggestEmails } from "@/lib/outreach/patterns";

const settings = defaultColdEmailSettings();
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const codes = (subject: string, body: string) => checkEmail({ subject, body }, settings).map((c) => c.code);

describe("checkEmail", () => {
  it("passes a clean 80-word email", () => {
    expect(codes("your onboarding, timed", words(80))).toEqual([]);
  });

  it("blocks an empty subject or body", () => {
    expect(codes("", "")).toEqual(["no_subject", "no_body"]);
  });

  it("blocks unfilled placeholders, in the subject too", () => {
    const out = checkEmail({ subject: "hi [Name]", body: `${words(80)} [link]` }, settings);
    const placeholder = out.find((c) => c.code === "placeholder");
    expect(placeholder?.level).toBe("error");
    expect(placeholder?.message).toContain("[Name]");
    expect(placeholder?.message).toContain("[link]");
  });

  it("warns about length outside the configured range", () => {
    expect(codes("subject", words(30))).toContain("short");
    expect(codes("subject", words(200))).toContain("long");
  });

  it("flags banned phrases, long dashes, bullets and too many links", () => {
    const body = `${words(70)}\nI hope this finds you well — I'm passionate.\n- one\nhttps://a.com https://b.com https://c.com`;
    const c = codes("subject", body);
    expect(c).toEqual(expect.arrayContaining(["banned", "dash", "bullets", "links"]));
    expect(checkEmail({ subject: "s", body }, settings).every((x) => x.level === "warn")).toBe(true);
  });

  it("uses the user's extra banned phrases", () => {
    const custom = { ...settings, extraBannedPhrases: ["synergy"] };
    expect(checkEmail({ subject: "s", body: `${words(80)} synergy` }, custom).map((c) => c.code)).toContain("banned");
  });
});

describe("findBanned", () => {
  it("matches whole phrases, case-insensitively, and curly apostrophes", () => {
    expect(findBanned("We LEVERAGE tools")).toEqual(["leverage"]);
    expect(findBanned("I’m a huge fan")).toEqual(["I'm a huge fan"]);
  });
  it("does not match inside other words", () => {
    expect(findBanned("This is a leveraged buyout, unexcited")).toEqual([]);
  });
});

describe("wordCount", () => {
  it("counts words across whitespace and lines", () => {
    expect(wordCount("  a b\n\nc  ")).toBe(3);
    expect(wordCount("")).toBe(0);
  });
});

describe("send timing and warnings", () => {
  // Tuesday 2026-10-06 10:00 local time
  const tueMorning = new Date(2026, 9, 6, 10, 0);
  const satNight = new Date(2026, 9, 10, 23, 0);

  it("accepts the configured days and window", () => {
    expect(sendTimingWarning(settings, tueMorning)).toBeNull();
    expect(sendTimingWarning(settings, satNight)).toContain("Outside your usual send time");
    expect(sendTimingWarning({ ...settings, sendDays: ["thu", "mon", "wed"] }, satNight)).toContain("(Mon, Wed, Thu,");
    expect(sendTimingWarning(settings, new Date(2026, 9, 6, 15, 0))).not.toBeNull();
  });

  it("warns about unverified addresses only when the setting asks for verified ones", () => {
    const to = { name: "Jane", emailStatus: "unverified" as const, sentCount: 0 };
    expect(sendWarnings(to, settings, tueMorning).map((w) => w.code)).toEqual(["unverified"]);
    expect(sendWarnings(to, { ...settings, requireVerifiedAddress: false }, tueMorning)).toEqual([]);
    expect(sendWarnings({ ...to, emailStatus: "risky" }, { ...settings, requireVerifiedAddress: false }, tueMorning).map((w) => w.code)).toEqual(["unverified"]);
    expect(sendWarnings({ ...to, emailStatus: "verified" }, settings, tueMorning)).toEqual([]);
  });

  it("warns when the same person was already emailed", () => {
    const w = sendWarnings({ name: "Jane", emailStatus: "verified", sentCount: 2 }, settings, tueMorning);
    expect(w.map((x) => x.code)).toEqual(["duplicate"]);
    expect(w[0].message).toContain("2 times");
  });
});

describe("generic inboxes", () => {
  it("recognises shared mailboxes", () => {
    expect(isGenericInbox("careers@acme.com")).toBe(true);
    expect(isGenericInbox("jane.doe@acme.com")).toBe(false);
  });
});

describe("suggestEmails", () => {
  it("lists common formats, most common first, without accents or punctuation", () => {
    expect(suggestEmails("José O'Neil", "acme.com")).toEqual([
      "jose.oneil@acme.com",
      "jose@acme.com",
      "joneil@acme.com",
      "joseoneil@acme.com",
      "joseo@acme.com",
      "jose_oneil@acme.com",
    ]);
  });
  it("needs a first and last name and a domain", () => {
    expect(suggestEmails("Madonna", "acme.com")).toEqual([]);
    expect(suggestEmails("Jane Doe", "")).toEqual([]);
  });
});
