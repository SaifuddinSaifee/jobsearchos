import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { contacts, documents, emailAccounts, files, outreachAttachments, outreachEmails, resumeIndexes } from "@/lib/db/schema";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument, createVersion, latestVersion, listDocuments, saveDraft as saveDocumentDraft } from "@/lib/documents/service";
import { isKnownResumeFile } from "@/lib/resume/files";
import { putFile } from "@/lib/storage/local";
import { DOCX_MIME, makeDocx } from "./docx";
import { defaultColdEmailSettings, saveColdEmailSettings } from "@/lib/email/settings";
import { resetEnv } from "@/lib/env";
import { emptyExtraction, type JobDraft } from "@/lib/jobs/schema";
import { saveJob } from "@/lib/jobs/service";
import { ProspeoError } from "@/lib/outreach/prospeo";
import {
  addContact,
  findContacts,
  getDraft,
  prepareAttachments,
  getOutreachData,
  listContacts,
  listSent,
  markVerified,
  OutreachError,
  removeContact,
  revealContactEmail,
  attachmentOptions,
  reuseAsDraft,
  saveDraft,
  sendDraft,
  uploadAttachmentForJob,
  uploadResumeForJob,
  sentToday,
  setDoNotContact,
  setJobCompanyWebsite,
  type FindDeps,
} from "@/lib/outreach/service";
import type { AttachmentRef } from "@/lib/outreach/types";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
const TUE_MORNING = new Date(2026, 9, 6, 10, 0);
const GOOD_BODY = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
const savedEnv = { PROSPEO_API_KEY: process.env.PROSPEO_API_KEY };

function job(n: number): JobDraft {
  const e = { ...emptyExtraction(), company: `Acme${n}`, title: `Data Engineer ${n}`, location: "Remote", technologies: [], keywords: [] };
  return {
    ...e,
    sourceUrl: `https://boards.greenhouse.io/acme${n}/jobs/${n}`,
    fetchMethod: "greenhouse",
    ats: "greenhouse",
    atsJobId: String(n),
    rawFileId: null,
    rawText: "Questions? Email Jane Doe, our recruiter.",
    normalized: e,
  };
}

async function seedJob(n = 1) {
  const r = await saveJob(job(n), db);
  if (!r.ok) throw new Error("seed failed");
  return r.jobId;
}

async function connectGmail() {
  await db.insert(emailAccounts).values({ provider: "gmail", email: "me@gmail.com", scopes: ["https://www.googleapis.com/auth/gmail.send"], refreshTokenEnc: "x" });
}

beforeEach(async () => {
  process.env.PROSPEO_API_KEY = "prospeo-key";
  resetEnv();
  await resetDb(db);
});
afterEach(() => {
  if (savedEnv.PROSPEO_API_KEY === undefined) delete process.env.PROSPEO_API_KEY;
  else process.env.PROSPEO_API_KEY = savedEnv.PROSPEO_API_KEY;
  resetEnv();
});
afterAll(() => db.$client.end());

const prospeoPerson = (over: object = {}) => ({
  personId: "p-john",
  firstName: "John",
  lastName: "Smith",
  fullName: "John Smith",
  title: "Head of Data",
  linkedinUrl: null,
  ...over,
});

function deps(over: FindDeps = {}): FindDeps {
  return {
    search: null,
    posting: async () => [
      { name: "Jane Doe", title: "Recruiter", email: null, kind: "recruiter", evidence: "Email Jane Doe" },
      { name: "Careers Team", title: "", email: "careers@acme1.com", kind: "other", evidence: "careers inbox" },
    ],
    lookup: async () => [prospeoPerson()],
    // The model is replaced by a simple rule: heads of a function first, then everyone else.
    rank: async (_job, list) =>
      list.map((c) => ({ id: c.id, kind: c.title.includes("Head") ? ("hiring_manager" as const) : ("recruiter" as const), score: c.title.includes("Head") ? 90 : 60, reason: `Reason for ${c.name}` })),
    // The automatic email lookup must never reach the network in tests.
    reveal: { enrich: async () => null, search: null },
    ...over,
  };
}

describe("findContacts", () => {
  it("combines the posting and Prospeo, ranks them and drops shared inboxes", async () => {
    const jobId = await seedJob();
    const res = await findContacts(jobId, deps(), db);
    expect(res.found).toBe(2);
    const list = await listContacts(jobId, db);
    expect(list.map((c) => [c.rank, c.name, c.kind])).toEqual([
      [1, "John Smith", "hiring_manager"],
      [2, "Jane Doe", "recruiter"],
    ]);
    expect(list[0]).toMatchObject({ email: null, emailStatus: "none", source: "prospeo", hasLookupId: true, reason: "Reason for John Smith" });
    expect(list[1]).toMatchObject({ email: null, source: "posting", hasLookupId: false });
  });

  it("merges a person the posting names with Prospeo's entry for the same name, keeping the id", async () => {
    const jobId = await seedJob();
    await findContacts(jobId, deps({ lookup: async () => [prospeoPerson({ personId: "p-jane", firstName: "Jane", lastName: "Doe", fullName: "Jane Doe", title: "Technical Recruiter" })] }), db);
    const list = await listContacts(jobId, db);
    expect(list.filter((c) => c.name === "Jane Doe")).toHaveLength(1);
    expect(list.find((c) => c.name === "Jane Doe")).toMatchObject({ source: "posting", hasLookupId: true });
    const [row] = await db.select().from(contacts).where(eq(contacts.name, "Jane Doe"));
    expect(row.providerId).toBe("p-jane");
  });

  it("searches Prospeo with the company's domain and titles aimed at the role", async () => {
    const jobId = await seedJob();
    await setJobCompanyWebsite(jobId, "https://www.acme1.com/about", db);
    const lookup = vi.fn(async () => []);
    await findContacts(jobId, deps({ lookup }), db);
    expect(lookup).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "acme1.com", company: "Acme1", titles: expect.arrayContaining(["head of data engineering", "recruiter", "founder"]) }),
      "prospeo-key",
    );
  });

  it("adds people found on the web, keeping their profile link", async () => {
    const jobId = await seedJob();
    await findContacts(
      jobId,
      deps({
        search: {} as never,
        web: async () => [{ name: "Priya Rao", title: "Engineering Manager, Data", linkedinUrl: "https://linkedin.com/in/priya", kind: "team_lead", sourceUrl: "https://linkedin.com/in/priya" }],
        lookup: async () => [],
      }),
      db,
    );
    const priya = (await listContacts(jobId, db)).find((c) => c.name === "Priya Rao");
    expect(priya).toMatchObject({ source: "web", linkedinUrl: "https://linkedin.com/in/priya", email: null });
  });

  it("is repeatable: no duplicates, and people who disappear are removed", async () => {
    const jobId = await seedJob();
    await findContacts(jobId, deps(), db);
    await findContacts(jobId, deps(), db);
    expect(await listContacts(jobId, db)).toHaveLength(2);
    await findContacts(jobId, deps({ lookup: async () => [] }), db);
    expect((await listContacts(jobId, db)).map((c) => c.name)).toEqual(["Jane Doe"]);
  });

  it("never touches people added by hand", async () => {
    const jobId = await seedJob();
    const mine = await addContact(jobId, { name: "My Friend", email: "friend@acme1.com", kind: "engineer" }, db);
    await findContacts(jobId, deps({ lookup: async () => [], posting: async () => [] }), db);
    expect((await listContacts(jobId, db)).map((c) => c.id)).toContain(mine.id);
  });

  it("keeps a removed-from-results person if an email was already sent to them", async () => {
    const jobId = await seedJob();
    await connectGmail();
    await findContacts(jobId, deps(), db);
    const john = (await listContacts(jobId, db)).find((c) => c.name === "John Smith")!;
    await revealContactEmail(john.id, { enrich: async () => ({ email: "john@acme1.com", status: "verified" }) }, db);
    await saveDraft(jobId, { subject: "subject", body: GOOD_BODY, contactId: john.id }, db);
    await sendDraft(jobId, {}, { now: TUE_MORNING, send: async () => ({ messageId: "m", threadId: "t" }) }, db);
    await findContacts(jobId, deps({ lookup: async () => [] }), db);
    const kept = (await listContacts(jobId, db)).find((c) => c.id === john.id);
    expect(kept).toMatchObject({ rank: null, sentCount: 1 });
  });

  it("still shows the other sources when one fails, and says what went wrong", async () => {
    const jobId = await seedJob();
    const res = await findContacts(jobId, deps({ lookup: async () => { throw new ProspeoError("Your Prospeo credits are used up."); } }), db);
    expect(res.found).toBe(1);
    expect(res.notes).toContain("Your Prospeo credits are used up.");
  });

  it("falls back to a simple order when ranking fails", async () => {
    const jobId = await seedJob();
    const res = await findContacts(jobId, deps({ rank: async () => { throw new Error("model down"); } }), db);
    expect(res.found).toBe(2);
    expect(res.notes.join(" ")).toMatch(/could not rank/i);
    expect((await listContacts(jobId, db))[0].name).toBe("Jane Doe");
  });

  it("explains when nothing is configured and nobody is named", async () => {
    delete process.env.PROSPEO_API_KEY;
    resetEnv();
    const jobId = await seedJob();
    const res = await findContacts(jobId, deps({ posting: async () => [] }), db);
    expect(res.found).toBe(0);
    expect(res.notes.join(" ")).toMatch(/search or lookup key/i);
  });

  it("carries a do-not-contact decision over to the same address on other jobs", async () => {
    const a = await seedJob(1);
    const b = await seedJob(2);
    const withEmail = deps({ posting: async () => [{ name: "Jane Doe", title: "Recruiter", email: "jane@acme.com", kind: "recruiter", evidence: "" }], lookup: async () => [] });
    await findContacts(a, withEmail, db);
    const jane = (await listContacts(a, db))[0];
    await setDoNotContact(jane.id, true, db);
    await findContacts(b, withEmail, db);
    expect((await listContacts(b, db))[0]).toMatchObject({ email: "jane@acme.com", doNotContact: true });
  });
});

describe("revealContactEmail", () => {
  const offline = { search: null } as const;
  async function person(over: { website?: string } = {}) {
    const jobId = await seedJob();
    if (over.website) await setJobCompanyWebsite(jobId, over.website, db);
    await findContacts(jobId, deps({ posting: async () => [] }), db);
    const john = (await listContacts(jobId, db)).find((c) => c.name === "John Smith")!;
    return { jobId, john };
  }
  const found = (email: string, status: "verified" | "unverified" = "verified") => async () => ({ email, status });

  it("reveals a verified address through Prospeo, using the id from the search, and records where it came from", async () => {
    const { jobId, john } = await person();
    const enrich = vi.fn(found("john.smith@acme1.com"));
    const res = await revealContactEmail(john.id, { ...offline, enrich }, db);
    expect(res).toEqual({ kind: "found", email: "john.smith@acme1.com", status: "verified", source: "Prospeo", cost: 1 });
    expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ personId: "p-john" }), "prospeo-key");
    expect((await listContacts(jobId, db))[0]).toMatchObject({ email: "john.smith@acme1.com", emailStatus: "verified", emailSource: "Prospeo" });
  });

  it("uses the name and company website for someone found elsewhere", async () => {
    const jobId = await seedJob();
    await setJobCompanyWebsite(jobId, "acme1.com", db);
    const jane = await addContact(jobId, { name: "Jane Doe" }, db);
    const enrich = vi.fn(found("jane.doe@acme1.com"));
    await revealContactEmail(jane.id, { ...offline, enrich }, db);
    expect(enrich).toHaveBeenCalledWith({ personId: null, linkedinUrl: null, firstName: "Jane", lastName: "Doe", domain: "acme1.com" }, "prospeo-key");
  });

  it("tries free sources first and does not spend a credit when one answers", async () => {
    const jobId = await seedJob();
    await setJobCompanyWebsite(jobId, "acme1.com", db);
    const jane = await addContact(jobId, { name: "Jane Doe" }, db);
    const enrich = vi.fn(found("never@acme1.com"));
    const publicEmail = vi.fn(async () => ({ email: "jane@acme1.com", url: "https://www.github.com/jane/repo" }));
    const res = await revealContactEmail(jane.id, { search: {} as never, publicEmail, enrich }, db);
    expect(res).toMatchObject({ kind: "found", email: "jane@acme1.com", status: "unverified", source: "Seen publicly at github.com", cost: 0 });
    expect(enrich).not.toHaveBeenCalled();
    expect((await listContacts(jobId, db))[0]).toMatchObject({ email: "jane@acme1.com", emailStatus: "unverified", emailSource: "Seen publicly at github.com" });
  });

  it("reuses an address already saved for the same person on another job, free", async () => {
    const a = await seedJob(1);
    const b = await seedJob(2);
    const first = await addContact(a, { name: "Jane Doe", email: "jane@shared.com", linkedinUrl: "https://www.linkedin.com/in/jane" }, db);
    await markVerified(first.id, db);
    const again = await addContact(b, { name: "Jane Doe", linkedinUrl: "https://www.linkedin.com/in/JANE" }, db);
    const enrich = vi.fn();
    const res = await revealContactEmail(again.id, { ...offline, enrich }, db);
    expect(res).toMatchObject({ kind: "found", email: "jane@shared.com", status: "verified", source: "Saved from another job", cost: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("falls back to guesses, led by the format already used at the company, and saves nothing", async () => {
    const jobId = await seedJob();
    await setJobCompanyWebsite(jobId, "acme1.com", db);
    await addContact(jobId, { name: "Sam Lee", email: "slee@acme1.com" }, db);
    const ray = await addContact(jobId, { name: "Ray Fitzgerald" }, db);
    const res = await revealContactEmail(ray.id, { ...offline, enrich: async () => null }, db);
    expect(res.kind).toBe("guess");
    if (res.kind === "guess") expect(res.guesses.slice(0, 2)).toEqual(["rfitzgerald@acme1.com", "ray.fitzgerald@acme1.com"]);
    expect((await listContacts(jobId, db)).find((c) => c.name === "Ray Fitzgerald")).toMatchObject({ email: null });
  });

  it("works without any key, returning guesses", async () => {
    const jobId = await seedJob();
    await setJobCompanyWebsite(jobId, "acme1.com", db);
    const jane = await addContact(jobId, { name: "Jane Doe" }, db);
    delete process.env.PROSPEO_API_KEY;
    resetEnv();
    const res = await revealContactEmail(jane.id, offline, db);
    expect(res).toMatchObject({ kind: "guess", guesses: expect.arrayContaining(["jane.doe@acme1.com"]) });
  });

  it("needs the company website or another way to identify the person", async () => {
    const jobId = await seedJob();
    const jane = await addContact(jobId, { name: "Jane Doe" }, db);
    await expect(revealContactEmail(jane.id, offline, db)).rejects.toThrow(/company's website/);
    await setJobCompanyWebsite(jobId, "acme1.com", db);
    const mono = await addContact(jobId, { name: "Madonna" }, db);
    await expect(revealContactEmail(mono.id, offline, db)).rejects.toThrow(/first and last name/);
  });

  it("passes on Prospeo's own errors when nothing else found an address", async () => {
    const { john } = await person();
    await expect(
      revealContactEmail(john.id, { ...offline, enrich: async () => { throw new ProspeoError("Your Prospeo credits are used up."); } }, db),
    ).rejects.toMatchObject({ code: "blocked", message: "Your Prospeo credits are used up." });
  });

  it("refuses an address that is already in the list", async () => {
    const { jobId, john } = await person();
    await addContact(jobId, { name: "Someone Else", email: "john.smith@acme1.com" }, db);
    await expect(revealContactEmail(john.id, { ...offline, enrich: found("john.smith@acme1.com") }, db)).rejects.toThrow(/already in the list/);
  });
});

describe("Y Combinator jobs", () => {
  const ycUrl = "https://www.workatastartup.com/jobs/113897";
  const founders = (names: string[]) =>
    names.map((name) => ({ name, title: "Founder/CEO", linkedinUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s/g, "-")}`, bio: `${name} founded it.` }));
  const yc = (names: string[], over: object = {}) => async () => ({ slug: "trybloom", name: "Bloom", website: "https://trybloom.ai", teamSize: 3, batch: "P26", founders: founders(names), ...over });

  async function seedYc(posting: string) {
    const draftJob = job(7);
    const r = await saveJob({ ...draftJob, sourceUrl: ycUrl, rawText: posting }, db);
    if (!r.ok) throw new Error("seed failed");
    return r.jobId;
  }
  const onlyPosting = (name: string) => async () => [{ name, title: "", email: null, kind: "other" as const, evidence: `Intro call with ${name} (30 min)` }];

  it("turns a first name in the posting into the founder's full name, LinkedIn and bio", async () => {
    const jobId = await seedYc("Intro call with Ray (30 min)");
    const rank = vi.fn(async (_job: unknown, list: { id: number }[]) => list.map((c) => ({ id: c.id, kind: "founder" as const, score: 90, reason: "The founder named in the posting." })));
    await findContacts(jobId, deps({ yc: yc(["Ray Fitzgerald"]), posting: onlyPosting("Ray"), lookup: async () => [], rank: rank as never }), db);
    const list = await listContacts(jobId, db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "Ray Fitzgerald",
      title: "Founder/CEO",
      source: "yc",
      kind: "founder",
      about: "Ray Fitzgerald founded it.",
      linkedinUrl: "https://www.linkedin.com/in/ray-fitzgerald",
    });
    // The model is told how we know this person, and that the company is tiny.
    const [roleArg, candidates] = rank.mock.calls[0] as unknown as [{ context: string[] }, { note: string }[]];
    expect(roleArg.context).toEqual(["Y Combinator P26 startup", "team of 3 people"]);
    expect(candidates[0].note).toContain("founder listed on the company's Y Combinator page");
    expect(candidates[0].note).toContain("named in the job posting");
  });

  it("keeps two people apart when a first name could mean either", async () => {
    const jobId = await seedYc("Intro call with Ray");
    await findContacts(jobId, deps({ yc: yc(["Ray Fitzgerald", "Ray Chen"]), posting: onlyPosting("Ray"), lookup: async () => [] }), db);
    expect((await listContacts(jobId, db)).map((c) => c.name).sort()).toEqual(["Ray", "Ray Chen", "Ray Fitzgerald"]);
  });

  it("fills in the company website from the YC page and searches Prospeo by that exact domain", async () => {
    const jobId = await seedYc("");
    const lookup = vi.fn(async () => []);
    const res = await findContacts(jobId, deps({ yc: yc(["Ray Fitzgerald"]), posting: async () => [], lookup }), db);
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ domain: "trybloom.ai" }), "prospeo-key");
    expect((await getOutreachData(jobId, db)).domain).toBe("trybloom.ai");
    expect(res.notes.join(" ")).toContain("Set the company website to trybloom.ai");
  });

  it("does not overwrite a website you already set", async () => {
    const jobId = await seedYc("");
    await setJobCompanyWebsite(jobId, "mine.example.com", db);
    await findContacts(jobId, deps({ yc: yc(["Ray Fitzgerald"]), posting: async () => [], lookup: async () => [] }), db);
    expect((await getOutreachData(jobId, db)).domain).toBe("mine.example.com");
  });

  it("carries on with the other sources when the YC page cannot be read", async () => {
    const jobId = await seedYc("");
    const res = await findContacts(jobId, deps({ yc: async () => { throw new Error("The Y Combinator page could not be read (HTTP 503)."); } }), db);
    expect(res.notes[0]).toContain("HTTP 503");
    expect((await listContacts(jobId, db)).length).toBeGreaterThan(0);
  });

  it("does not look at Y Combinator for other jobs", async () => {
    const jobId = await seedJob();
    const fetchYc = vi.fn();
    await findContacts(jobId, deps({ yc: fetchYc }), db);
    expect(fetchYc).not.toHaveBeenCalled();
  });
});

describe("the best match's email", () => {
  const ycUrl = "https://www.workatastartup.com/jobs/113897";
  async function seedYc() {
    const r = await saveJob({ ...job(8), sourceUrl: ycUrl, rawText: "Intro call with Ray" }, db);
    if (!r.ok) throw new Error("seed failed");
    return r.jobId;
  }
  const ycDep = async () => ({
    slug: "trybloom",
    name: "Bloom",
    website: "https://trybloom.ai",
    teamSize: 3,
    batch: "P26",
    founders: [{ name: "Ray Fitzgerald", title: "Founder/CEO", linkedinUrl: "https://www.linkedin.com/in/ray-fitzgerald", bio: "" }],
  });
  const base = (over: FindDeps = {}): FindDeps =>
    deps({ yc: ycDep, posting: async () => [{ name: "Ray", title: "", email: null, kind: "other", evidence: "Intro call with Ray" }], lookup: async () => [], ...over });

  it("is looked up automatically for a person the posting points to, and saved with its source", async () => {
    const jobId = await seedYc();
    const enrich = vi.fn(async () => ({ email: "ray@trybloom.ai", status: "verified" as const }));
    const res = await findContacts(jobId, base({ reveal: { enrich, search: null } }), db);
    expect(enrich).toHaveBeenCalledWith(expect.objectContaining({ linkedinUrl: "https://www.linkedin.com/in/ray-fitzgerald", domain: "trybloom.ai" }), "prospeo-key");
    expect((await listContacts(jobId, db))[0]).toMatchObject({ name: "Ray Fitzgerald", email: "ray@trybloom.ai", emailStatus: "verified", emailSource: "Prospeo" });
    expect(res.notes.join(" ")).toContain("1 Prospeo credit");
  });

  it("only ever looks up one person per search", async () => {
    const jobId = await seedYc();
    const enrich = vi.fn(async () => ({ email: "ray@trybloom.ai", status: "verified" as const }));
    await findContacts(jobId, base({ lookup: async () => [{ personId: "p2", firstName: "Mel", lastName: "S", fullName: "Mel Stokke", title: "CEO", linkedinUrl: null }], reveal: { enrich, search: null } }), db);
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  it("is skipped when turned off in Settings, and spends nothing", async () => {
    const jobId = await seedYc();
    await saveColdEmailSettings({ ...defaultColdEmailSettings(), autoRevealBest: false }, db);
    const enrich = vi.fn();
    await findContacts(jobId, base({ reveal: { enrich, search: null } }), db);
    expect(enrich).not.toHaveBeenCalled();
  });

  it("is skipped when we are not sure who the best match is", async () => {
    const jobId = await seedJob();
    const enrich = vi.fn();
    await findContacts(
      jobId,
      deps({
        posting: async () => [],
        lookup: async () => [{ personId: "p1", firstName: "Al", lastName: "B", fullName: "Al B", title: "VP", linkedinUrl: null }],
        rank: async (_j, list) => list.map((c) => ({ id: c.id, kind: "other" as const, score: 40, reason: "maybe" })),
        reveal: { enrich, search: null },
      }),
      db,
    );
    expect(enrich).not.toHaveBeenCalled();
  });

  it("does not look up someone who already has an address", async () => {
    const jobId = await seedYc();
    const enrich = vi.fn(async () => ({ email: "ray@trybloom.ai", status: "verified" as const }));
    await findContacts(jobId, base({ reveal: { enrich, search: null } }), db);
    enrich.mockClear();
    await findContacts(jobId, base({ reveal: { enrich, search: null } }), db);
    expect(enrich).not.toHaveBeenCalled();
    expect((await listContacts(jobId, db))[0].email).toBe("ray@trybloom.ai");
  });

  it("reports an error as a note without failing the search", async () => {
    const jobId = await seedYc();
    const res = await findContacts(jobId, base({ reveal: { search: null, enrich: async () => { throw new ProspeoError("Your Prospeo credits are used up."); } } }), db);
    expect(res.found).toBe(1);
    expect(res.notes).toContain("Your Prospeo credits are used up.");
  });
});

describe("contacts by hand", () => {
  it("validates input and rejects duplicate emails on one job", async () => {
    const jobId = await seedJob();
    await expect(addContact(jobId, { name: "" }, db)).rejects.toThrow();
    await expect(addContact(jobId, { name: "A B", email: "not-an-email" }, db)).rejects.toThrow();
    await addContact(jobId, { name: "A B", email: "A.B@x.com" }, db);
    await expect(addContact(jobId, { name: "A B2", email: "a.b@x.com" }, db)).rejects.toThrow(/already in the list/);
  });

  it("stores a typed address as unverified until the user confirms it", async () => {
    const jobId = await seedJob();
    const c = await addContact(jobId, { name: "A B", email: "a@x.com" }, db);
    expect(c.emailStatus).toBe("unverified");
    await markVerified(c.id, db);
    expect((await listContacts(jobId, db))[0].emailStatus).toBe("verified");
  });

  it("removes a contact and clears it from the draft", async () => {
    const jobId = await seedJob();
    const c = await addContact(jobId, { name: "A B", email: "a@x.com" }, db);
    await saveDraft(jobId, { subject: "s", body: "b", contactId: c.id }, db);
    await removeContact(c.id, db);
    expect(await listContacts(jobId, db)).toEqual([]);
    expect((await getDraft(jobId, db))?.contactId).toBeNull();
  });
});

describe("drafts", () => {
  it("keeps one draft per job and updates it in place", async () => {
    const jobId = await seedJob();
    await saveDraft(jobId, { subject: "one", body: "first" }, db);
    await saveDraft(jobId, { subject: "two", body: "second" }, db);
    expect(await db.select().from(outreachEmails)).toHaveLength(1);
    expect(await getDraft(jobId, db)).toMatchObject({ subject: "two", body: "second", contactId: null });
  });

  it("keeps the recipient when it is not mentioned, and clears it on null", async () => {
    const jobId = await seedJob();
    const c = await addContact(jobId, { name: "A B", email: "a@x.com" }, db);
    await saveDraft(jobId, { subject: "s", body: "b", contactId: c.id }, db);
    await saveDraft(jobId, { subject: "s2", body: "b2" }, db);
    expect((await getDraft(jobId, db))?.contactId).toBe(c.id);
    await saveDraft(jobId, { subject: "s2", body: "b2", contactId: null }, db);
    expect((await getDraft(jobId, db))?.contactId).toBeNull();
  });

  it("refuses a contact from another job and oversized text", async () => {
    const a = await seedJob(1);
    const b = await seedJob(2);
    const c = await addContact(a, { name: "A B", email: "a@x.com" }, db);
    await expect(saveDraft(b, { subject: "s", body: "b", contactId: c.id }, db)).rejects.toThrow(/different job/);
    await expect(saveDraft(b, { subject: "s".repeat(400), body: "b" }, db)).rejects.toThrow();
  });
});

describe("sendDraft", () => {
  const send = vi.fn(async () => ({ messageId: "msg-1", threadId: "thr-1" }));
  beforeEach(() => send.mockClear());

  async function ready(over: { email?: string; verified?: boolean; body?: string } = {}) {
    const jobId = await seedJob();
    await connectGmail();
    const c = await addContact(jobId, { name: "Jane Doe", email: over.email ?? "jane@acme1.com", kind: "recruiter" }, db);
    if (over.verified !== false) await markVerified(c.id, db);
    await saveDraft(jobId, { subject: "your onboarding, timed", body: over.body ?? GOOD_BODY, contactId: c.id }, db);
    return { jobId, contactId: c.id };
  }
  const go = (jobId: string, ack: string[] = []) => sendDraft(jobId, { acknowledge: ack }, { send, now: TUE_MORNING }, db);
  const fails = async (p: Promise<unknown>, code: OutreachError["code"], message?: RegExp) => {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect((err as OutreachError).code).toBe(code);
    if (message) expect((err as OutreachError).message).toMatch(message);
    expect(send).not.toHaveBeenCalled();
    return err as OutreachError;
  };

  it("sends, records the Gmail ids, and consumes the draft", async () => {
    const { jobId, contactId } = await ready();
    const sent = await go(jobId);
    expect(sent).toMatchObject({ contactId, contactName: "Jane Doe", toEmail: "jane@acme1.com", threadId: "thr-1" });
    expect(send).toHaveBeenCalledWith({ to: "jane@acme1.com", subject: "your onboarding, timed", body: GOOD_BODY, bcc: undefined });
    expect(await getDraft(jobId, db)).toBeNull();
    expect(await listSent(jobId, db)).toHaveLength(1);
    expect((await listContacts(jobId, db))[0].sentCount).toBe(1);
    expect(await sentToday(db, TUE_MORNING)).toBe(1);
  });

  it("copies the sender to itself when the setting is on", async () => {
    await saveColdEmailSettings({ ...defaultColdEmailSettings(), bccSelf: true }, db);
    const { jobId } = await ready();
    await go(jobId);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ bcc: "me@gmail.com" }));
  });

  it("needs a draft and a recipient", async () => {
    const jobId = await seedJob();
    await fails(go(jobId), "not_found");
    await saveDraft(jobId, { subject: "s", body: GOOD_BODY }, db);
    await fails(go(jobId), "invalid", /who to send/i);
  });

  it("refuses a recipient without an address, with an invalid address, or marked do not contact", async () => {
    const jobId = await seedJob();
    await connectGmail();
    const none = await addContact(jobId, { name: "No Mail" }, db);
    await saveDraft(jobId, { subject: "s", body: GOOD_BODY, contactId: none.id }, db);
    await fails(go(jobId), "invalid", /no email/i);

    const bad = await addContact(jobId, { name: "Bad Mail", email: "bad@x.com" }, db);
    await db.update(contacts).set({ emailStatus: "invalid" }).where(eq(contacts.id, bad.id));
    await saveDraft(jobId, { subject: "s", body: GOOD_BODY, contactId: bad.id }, db);
    await fails(go(jobId), "blocked", /not a working address/i);

    const dnc = await addContact(jobId, { name: "No Thanks", email: "dnc@x.com" }, db);
    await setDoNotContact(dnc.id, true, db);
    await saveDraft(jobId, { subject: "s", body: GOOD_BODY, contactId: dnc.id }, db);
    await fails(go(jobId), "blocked", /do not contact/i);
  });

  it("refuses an email with unfilled placeholders or no subject", async () => {
    const { jobId } = await ready({ body: `${GOOD_BODY} [link]` });
    await fails(go(jobId), "invalid", /\[link\]/);
    await saveDraft(jobId, { subject: "", body: GOOD_BODY }, db);
    await fails(go(jobId), "invalid", /subject/i);
  });

  it("needs Gmail connected and healthy", async () => {
    const { jobId } = await ready();
    await db.update(emailAccounts).set({ needsReconnect: true });
    await fails(go(jobId), "not_connected", /reconnected/i);
    await db.delete(emailAccounts);
    await fails(go(jobId), "not_connected", /Connect Gmail/i);
  });

  it("enforces the daily limit", async () => {
    await saveColdEmailSettings({ ...defaultColdEmailSettings(), dailyCap: 1 }, db);
    const { jobId } = await ready();
    await db.insert(outreachEmails).values({ jobId, status: "sent", sentAt: TUE_MORNING, toEmail: "other@x.com" });
    await fails(go(jobId), "blocked", /daily limit of 1/i);
  });

  it("makes the user acknowledge warnings, and the server checks they did", async () => {
    const { jobId } = await ready({ verified: false });
    const err = await fails(go(jobId), "needs_ack");
    expect(err.needs?.map((w) => w.code)).toEqual(["unverified"]);
    await fails(go(jobId, ["something-else"]), "needs_ack");
    await go(jobId, ["unverified"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("asks again before emailing the same person twice about one job", async () => {
    const { jobId, contactId } = await ready();
    await go(jobId);
    send.mockClear();
    await saveDraft(jobId, { subject: "second", body: GOOD_BODY, contactId }, db);
    const err = await fails(go(jobId), "needs_ack");
    expect(err.needs?.map((w) => w.code)).toEqual(["duplicate"]);
    await go(jobId, ["duplicate"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and records the error when Gmail fails", async () => {
    const { jobId } = await ready();
    const failing = vi.fn(async () => { throw new Error("Gmail send failed: Invalid To header"); });
    await expect(sendDraft(jobId, {}, { send: failing, now: TUE_MORNING }, db)).rejects.toMatchObject({ code: "send_failed" });
    const [row] = await db.select().from(outreachEmails);
    expect(row).toMatchObject({ status: "draft", error: expect.stringContaining("Invalid To header") });
    expect(await listSent(jobId, db)).toEqual([]);
  });

  it("cannot be sent twice at once", async () => {
    const { jobId } = await ready();
    let release: () => void = () => {};
    const slow = vi.fn(() => new Promise<{ messageId: string; threadId: string }>((resolve) => { release = () => resolve({ messageId: "m", threadId: "t" }); }));
    const first = sendDraft(jobId, {}, { send: slow, now: TUE_MORNING }, db);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    await expect(go(jobId)).rejects.toMatchObject({ code: "not_found" });
    release();
    await first;
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it("copies a sent email back into the draft without a recipient", async () => {
    const { jobId } = await ready();
    const sent = await go(jobId);
    const draft = await reuseAsDraft(jobId, sent.id, db);
    expect(draft).toMatchObject({ subject: "your onboarding, timed", body: GOOD_BODY, contactId: null });
    expect(await listSent(jobId, db)).toHaveLength(1);
  });

  const PROPOSAL = "https://github.com/someone/project/blob/main/PROPOSALS.md";
  /** GOOD_BODY, a blank line, then "My proposal (GitHub)" linked and bolded, the way the editor sends it. */
  const formattedDoc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: GOOD_BODY }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "My proposal (GitHub)", marks: [{ type: "bold" }, { type: "link", attrs: { href: PROPOSAL, target: "_blank", rel: "noopener noreferrer", class: null } }] }] },
      { type: "paragraph" },
    ],
  };

  it("stores a formatted body, with its plain text made from it", async () => {
    const { jobId, contactId } = await ready();
    const draft = await saveDraft(jobId, { subject: "s", body: "ignored when a formatted body is given", bodyDoc: formattedDoc, contactId }, db);
    expect(draft.body).toBe(`${GOOD_BODY}\n\nMy proposal (GitHub) <${PROPOSAL}>\n`);
    expect(draft.bodyDoc?.content[2].content?.[0].marks).toEqual([{ type: "link", attrs: { href: PROPOSAL } }, { type: "bold" }]);
    // Saving plain text again drops the formatting.
    expect((await saveDraft(jobId, { subject: "s", body: "plain" }, db)).bodyDoc).toBeNull();
  });

  it("sends a formatted email with an HTML version, and files it in the library with its formatting", async () => {
    const { jobId, contactId } = await ready();
    await saveDraft(jobId, { subject: "your onboarding, timed", body: "", bodyDoc: formattedDoc, contactId }, db);
    const sent = await go(jobId);
    const message = (send.mock.calls[0] as unknown[])[0] as { body: string; html?: string };
    expect(message.body).toBe(`${GOOD_BODY}\n\nMy proposal (GitHub) <${PROPOSAL}>`);
    // The trailing blank line is trimmed, as the plain text is.
    expect(message.html).toBe(`<div dir="ltr"><div>${GOOD_BODY}</div><div><br></div><div><a href="${PROPOSAL}"><b>My proposal (GitHub)</b></a></div></div>`);
    expect(sent.bodyDoc).not.toBeNull();
    expect((await listSent(jobId, db))[0].bodyDoc).toEqual(sent.bodyDoc);

    const [doc] = await db.select().from(documents).where(eq(documents.outreachEmailId, sent.id));
    const version = await latestVersion(doc.id, db);
    expect(JSON.stringify(version?.content)).toContain(PROPOSAL);
    expect(version?.plainText).toContain("My proposal (GitHub)");
    expect((await reuseAsDraft(jobId, sent.id, db)).bodyDoc).toEqual(sent.bodyDoc);
  });

  it("sends a plain email without an HTML version", async () => {
    const { jobId } = await ready();
    await go(jobId);
    expect(((send.mock.calls[0] as unknown[])[0] as { html?: string }).html).toBeUndefined();
  });
});

describe("getOutreachData", () => {
  it("returns everything the page needs", async () => {
    const jobId = await seedJob();
    const data = await getOutreachData(jobId, db);
    expect(data).toMatchObject({ contacts: [], draft: null, sent: [], sentToday: 0, account: null, domain: null, canSaveWebsite: true });
    expect(data.sources.prospeo).toBe(true);
    expect(data.settings.dailyCap).toBe(25);
  });
});


describe("attachments", () => {
  let dir: string;
  const send = vi.fn(async (...args: unknown[]) => (void args, { messageId: "msg-1", threadId: "thr-1" }));
  let pdfCount = 0;
  /** A stand-in for the browser: a different "PDF" every time, so reuse can be told from remaking. */
  const fakePdf = vi.fn(async () => ({ bytes: Buffer.from(`%PDF-1.7 fake ${++pdfCount}`), pages: 1 }));
  const mime = DOCX_MIME;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jt-attach-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    send.mockClear();
    fakePdf.mockClear();
    pdfCount = 0;
    process.env.STORAGE_DIR = dir;
    resetEnv();
  });
  afterEach(() => {
    delete process.env.STORAGE_DIR;
    resetEnv();
  });

  /** A resume the way the composer's upload makes one: content in the library, and its original file kept. */
  async function uploaded(name: string, text = "Jane Doe resume", over: { base?: boolean; jobId?: string; bytes?: Buffer } = {}) {
    const file = await putFile(over.bytes ?? (await makeDocx([text])), { mime, originalName: name }, { dir, db });
    const { document, version } = await createDocument(
      { kind: "resume", origin: "uploaded", title: name, content: textToDoc(text), isBase: over.base, jobId: over.jobId, sourceName: name, sourceFileId: file.id },
      db,
    );
    return { file, document, version };
  }
  const baseResume = (name = "base-resume.docx", text = "Jane Doe base resume") => uploaded(name, text, { base: true });
  /** A resume that only exists as text in the library (made in the app), so it can only go out as a PDF. */
  async function libraryResume(title = "Base resume", text = "Jane Doe\n\nSUMMARY\nMade in the app", base = true) {
    return createDocument({ kind: "resume", origin: "blank", title, content: textToDoc(text), isBase: base }, db);
  }

  async function ready(attachments?: AttachmentRef[]) {
    const jobId = await seedJob();
    await connectGmail();
    const c = await addContact(jobId, { name: "Jane Doe", email: "jane@acme1.com", kind: "recruiter" }, db);
    await markVerified(c.id, db);
    await saveDraft(jobId, { subject: "your onboarding, timed", body: GOOD_BODY, contactId: c.id, attachments }, db);
    return { jobId, contactId: c.id };
  }
  const go = (jobId: string, ack: string[] = [], over: object = {}) => sendDraft(jobId, { acknowledge: ack }, { send, now: TUE_MORNING, pdf: fakePdf, storageDir: dir, ...over }, db);
  const sentMessage = () => send.mock.calls[0][0] as { attachments?: { filename: string; mime: string; content: Buffer }[] };

  it("starts a new draft with the base resume attached, and keeps the choice on later saves", async () => {
    const base = await baseResume();
    const jobId = await seedJob();
    const first = await saveDraft(jobId, { subject: "s", body: "b" }, db);
    expect(first.attachments).toHaveLength(1);
    expect(first.attachments[0]).toMatchObject({ documentId: base.document.id, docKind: "resume", source: "file", fileId: base.file.id, name: "base-resume.docx", mime });

    const none = await saveDraft(jobId, { subject: "s2", body: "b2", attachments: [] }, db);
    expect(none.attachments).toEqual([]);
    const kept = await saveDraft(jobId, { subject: "s3", body: "b3" }, db);
    expect(kept.attachments).toEqual([]);
  });

  it("offers a resume made in the app as a PDF to be made when the email is sent", async () => {
    const base = await libraryResume("My resume");
    const draft = await saveDraft(await seedJob(), { subject: "s", body: "b" }, db);
    // The name is the one the export will give it: the person at the top of the resume.
    expect(draft.attachments[0]).toMatchObject({ documentId: base.document.id, source: "pdf", fileId: null, size: null, mime: "application/pdf", name: "Jane Doe.pdf" });
  });

  it("lists the base resume first, then this job's uploads, then the rest of the library", async () => {
    const base = await baseResume();
    const jobA = await seedJob(1);
    const jobB = await seedJob(2);
    const forA = await uploadResumeForJob(jobA, { bytes: await makeDocx(["Resume tuned for A"]), name: "for-a.docx", mime }, db);
    const forB = await uploadResumeForJob(jobB, { bytes: await makeDocx(["Resume tuned for B"]), name: "for-b.docx", mime }, db);
    await libraryResume("Written in the app", "text only", false);

    const options = await attachmentOptions(jobA, db);
    expect(options.map((o) => [o.kind, o.name])).toEqual([
      ["base", "base-resume.docx"],
      ["job", "for-a.docx"],
      ["past", "text only.pdf"],
      ["past", "for-b.docx"],
    ]);
    expect(options[0].documentId).toBe(base.document.id);
    expect(forA.kind).toBe("job");
    expect(forB.documentId).not.toBe(forA.documentId);
  });

  it("offers the PDF, not the original file, once an upload has been edited", async () => {
    const r = await uploaded("tuned.docx", "Original text");
    const jobId = await seedJob();
    expect((await attachmentOptions(jobId, db))[0]).toMatchObject({ source: "file", fileId: r.file.id });
    await saveDocumentDraft(r.document.id, { content: textToDoc("Edited text"), revision: 1 }, db);
    await createVersion(r.document.id, { reason: "manual" }, db);
    expect((await attachmentOptions(jobId, db))[0]).toMatchObject({ source: "pdf", fileId: null, name: "Edited text.pdf" });
  });

  it("files an uploaded resume in the library with the job it was written for, and queues its index", async () => {
    const jobId = await seedJob();
    const up = await uploadResumeForJob(jobId, { bytes: await makeDocx(["Tailored resume text"]), name: "tailored.docx", mime }, db);
    expect(up).toMatchObject({ source: "file", kind: "job" });
    const [doc] = await db.select().from(documents).where(eq(documents.id, up.documentId!));
    expect(doc).toMatchObject({ kind: "resume", origin: "uploaded", sourceFileId: up.fileId, jobId, companyName: "Acme1", targetRole: "Data Engineer 1", title: "Resume for Acme1", sourceName: "tailored.docx" });
    expect(doc.jdText).toContain("recruiter");
    const version = await latestVersion(doc.id, db);
    expect(version?.plainText).toContain("Tailored resume text");
    expect((await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, version!.id)))[0].status).toBe("queued");
  });

  it("uploading the same file twice reuses it", async () => {
    const jobId = await seedJob();
    const bytes = await makeDocx(["Same resume"]);
    const a = await uploadResumeForJob(jobId, { bytes, name: "r.docx", mime }, db);
    const b = await uploadResumeForJob(jobId, { bytes, name: "r.docx", mime }, db);
    expect(b.fileId).toBe(a.fileId);
    expect(b.documentId).toBe(a.documentId);
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("rejects files that are not resumes or are too large", async () => {
    const jobId = await seedJob();
    await expect(uploadResumeForJob(jobId, { bytes: Buffer.from("hi"), name: "notes.txt", mime: "text/plain" }, db)).rejects.toThrow(/PDF and DOCX/);
    await expect(uploadResumeForJob(jobId, { bytes: Buffer.alloc(6 * 1024 * 1024), name: "huge.pdf", mime: "application/pdf" }, db)).rejects.toThrow();
  });

  it("will only attach a resume or cover letter that is in the library, or a stored attachable file", async () => {
    const jobId = await seedJob();
    const mail = await createDocument({ kind: "email", origin: "blank", title: "E", content: textToDoc("Hi", { mode: "letter" }) }, db);
    await expect(saveDraft(jobId, { subject: "s", body: "b", attachments: [{ documentId: mail.document.id }] }, db)).rejects.toMatchObject({ code: "invalid" });
    await expect(saveDraft(jobId, { subject: "s", body: "b", attachments: [{ documentId: "00000000-0000-4000-8000-000000000000" }] }, db)).rejects.toMatchObject({ code: "invalid" });
    await expect(saveDraft(jobId, { subject: "s", body: "b", attachments: [{ fileId: "00000000-0000-4000-8000-000000000000" }] }, db)).rejects.toMatchObject({ code: "invalid" });
    const html = await putFile(Buffer.from("<script>x</script>"), { mime: "text/html", originalName: "x.html" }, { dir, db });
    await expect(saveDraft(jobId, { subject: "s", body: "b", attachments: [{ fileId: html.id }] }, db)).rejects.toMatchObject({ code: "invalid" });
  });

  it("sends an unedited upload as its original file, and locks that version", async () => {
    const base = await baseResume();
    const { jobId } = await ready();
    const sent = await go(jobId);

    expect(fakePdf).not.toHaveBeenCalled();
    const message = sentMessage();
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments![0]).toMatchObject({ filename: "base-resume.docx", mime });
    expect(message.attachments![0].content.length).toBe(base.file.size);
    expect(sent.attachments).toEqual([expect.objectContaining({ fileId: base.file.id, name: "base-resume.docx", documentId: base.document.id, version: 1 })]);

    const [listed] = await listSent(jobId, db);
    expect(listed.attachments[0]).toMatchObject({ fileId: base.file.id, name: "base-resume.docx", size: base.file.size, version: 1 });
    expect((await latestVersion(base.document.id, db))?.lockedAt).not.toBeNull();
    expect((await listDocuments({ kind: "resume" }, db))[0].locked).toBe(true);
  });

  it("makes a PDF from a resume that only exists as text, stores it, and records the version it came from", async () => {
    const r = await libraryResume();
    const { jobId } = await ready();
    const sent = await go(jobId);

    expect(fakePdf).toHaveBeenCalledOnce();
    // The file is named after the person on the resume, like every export.
    expect(sentMessage().attachments![0]).toMatchObject({ filename: "Jane Doe.pdf", mime: "application/pdf" });
    expect(sentMessage().attachments![0].content.toString()).toBe("%PDF-1.7 fake 1");
    const version = await latestVersion(r.document.id, db);
    expect(sent.attachments[0]).toMatchObject({ name: "Jane Doe.pdf", documentId: r.document.id, versionId: version!.id });
    // What went out is stored, so the history can always show it, and the version it came from is locked.
    expect((await db.select().from(files).where(eq(files.id, sent.attachments[0].fileId)))[0].size).toBe(sentMessage().attachments![0].content.length);
    expect(await isKnownResumeFile(sent.attachments[0].fileId, db)).toBe(true);
    expect(version?.lockedAt).not.toBeNull();
  });

  it("makes the PDF from the edited text when an upload has been changed", async () => {
    const r = await baseResume("jane.docx", "Original wording");
    await saveDocumentDraft(r.document.id, { content: textToDoc("Edited wording"), revision: 1 }, db);
    const { jobId } = await ready();
    const sent = await go(jobId);

    expect(fakePdf).toHaveBeenCalledOnce();
    expect(sentMessage().attachments![0].mime).toBe("application/pdf");
    const version = await latestVersion(r.document.id, db);
    expect(version).toMatchObject({ reason: "attach" });
    expect(version?.plainText).toContain("Edited wording");
    expect(sent.attachments[0]).toMatchObject({ versionId: version!.id, version: 2 });
  });

  it("makes the PDF once while nothing changes, and again after an edit, keeping the old file", async () => {
    const r = await libraryResume();
    const { jobId } = await ready();
    const [first] = await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    const [again] = await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    expect(fakePdf).toHaveBeenCalledOnce();
    expect(again).toMatchObject({ fileId: first.fileId, source: "pdf", versionCreated: false });
    expect(first).toMatchObject({ size: expect.any(Number), name: "Jane Doe.pdf", pages: 1, versionCreated: false });

    await saveDocumentDraft(r.document.id, { content: textToDoc("Changed since"), revision: 1 }, db);
    const [third] = await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    expect(fakePdf).toHaveBeenCalledTimes(2);
    expect(third.fileId).not.toBe(first.fileId);
    expect(third.versionCreated).toBe(true);
    expect((await db.select().from(files).where(eq(files.id, first.fileId))).length).toBe(1);
  });

  it("shows the prepared PDF on the draft until the resume changes", async () => {
    const r = await libraryResume();
    const { jobId } = await ready();
    expect((await getDraft(jobId, db))?.attachments[0]).toMatchObject({ source: "pdf", fileId: null, size: null });
    const [prepared] = await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    expect((await getDraft(jobId, db))?.attachments[0]).toMatchObject({ fileId: prepared.fileId, size: prepared.size });
    await saveDocumentDraft(r.document.id, { content: textToDoc("Changed since"), revision: 1 }, db);
    expect((await getDraft(jobId, db))?.attachments[0]).toMatchObject({ fileId: null, size: null });
  });

  it("files the sent email in the library, locked", async () => {
    await baseResume();
    const { jobId } = await ready();
    const sent = await go(jobId);
    const [doc] = await db.select().from(documents).where(eq(documents.outreachEmailId, sent.id));
    expect(doc).toMatchObject({ kind: "email", origin: "sent", jobId, title: "your onboarding, timed" });
    expect((await latestVersion(doc.id, db))?.lockedAt).not.toBeNull();
  });

  it("does not turn a library hiccup into a failed send", async () => {
    await baseResume();
    const { jobId } = await ready();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await db.insert(documents).values({ kind: "email", origin: "sent", title: "clash", outreachEmailId: (await db.select().from(outreachEmails))[0].id });
    const sent = await go(jobId);
    expect(sent.subject).toBe("your onboarding, timed");
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("still shows exactly what was sent after the base resume changes", async () => {
    const first = await baseResume("v1.docx", "first version");
    const { jobId } = await ready();
    await go(jobId);
    await baseResume("v2.docx", "second version");
    const [listed] = await listSent(jobId, db);
    expect(listed.attachments[0]).toMatchObject({ fileId: first.file.id, name: "v1.docx" });
  });

  it("sends nothing attached when the user chose no attachment", async () => {
    await baseResume();
    const { jobId } = await ready([]);
    const sent = await go(jobId);
    expect(sentMessage().attachments).toBeUndefined();
    expect(sent.attachments).toEqual([]);
    expect(fakePdf).not.toHaveBeenCalled();
  });

  it("copies the attachment choice when a sent email is reused", async () => {
    const base = await baseResume();
    const { jobId } = await ready();
    const sent = await go(jobId);
    const draft = await reuseAsDraft(jobId, sent.id, db);
    expect(draft.attachments.map((a) => a.documentId)).toEqual([base.document.id]);
  });

  it("asks for confirmation when the resume is large", async () => {
    await uploaded("big.docx", "Big resume", { base: true, bytes: Buffer.concat([await makeDocx(["Big resume"]), Buffer.alloc(1_200_000, 1)]) });
    const { jobId } = await ready();
    const err = await go(jobId).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(OutreachError);
    expect((err as OutreachError).needs?.map((w) => w.code)).toContain("big_attachment");
    expect(send).not.toHaveBeenCalled();
    await go(jobId, ["big_attachment"]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses a PDF over 5 MB, and says which resume it was made from", async () => {
    await libraryResume("Huge");
    const { jobId } = await ready();
    const huge = vi.fn(async () => ({ bytes: Buffer.alloc(6 * 1024 * 1024, 1), pages: 9 }));
    await expect(go(jobId, [], { pdf: huge })).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/PDF made from "Huge" is larger than 5 MB/) });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the draft and says so when the PDF cannot be made", async () => {
    await libraryResume();
    const { jobId } = await ready();
    const broken = vi.fn(async () => {
      throw new Error("Browser rendering is unavailable");
    });
    await expect(go(jobId, [], { pdf: broken })).rejects.toMatchObject({ code: "send_failed", message: expect.stringMatching(/Could not make the PDF.*unavailable/) });
    expect(send).not.toHaveBeenCalled();
    expect(await getDraft(jobId, db)).not.toBeNull();
  });

  it("keeps the draft and says so when the file cannot be read", async () => {
    await baseResume();
    const { jobId } = await ready();
    const unreadable = async (): Promise<Buffer> => {
      throw new Error("ENOENT");
    };
    await expect(go(jobId, [], { readFile: unreadable })).rejects.toMatchObject({ code: "send_failed", message: expect.stringMatching(/Could not read the attached file "base-resume.docx"/) });
    expect(send).not.toHaveBeenCalled();
    expect(await getDraft(jobId, db)).not.toBeNull();
  });

  it("reports the options and the default for the page", async () => {
    const base = await baseResume();
    const jobId = await seedJob();
    const data = await getOutreachData(jobId, db);
    expect(data.defaultAttachmentId).toBe(base.document.id);
    expect(data.options.map((r) => r.kind)).toEqual(["base"]);
  });

  /** A cover letter written in the app, for job `jobId`. */
  const coverLetter = (jobId?: string, text = "Jane Doe\n\nDear team, here is why I fit.") =>
    createDocument({ kind: "cover_letter", origin: "blank", title: "Cover letter", content: textToDoc(text), jobId, companyName: "Acme1", targetRole: "Data Engineer 1" }, db);
  const proposalBytes = Buffer.from("%PDF-1.4 my proposal");

  it("sends several attachments in the order chosen: a resume, a cover letter and an uploaded file", async () => {
    const base = await baseResume();
    const { jobId } = await ready();
    const letter = await coverLetter(jobId);
    const proposal = await uploadAttachmentForJob(jobId, { bytes: proposalBytes, name: "Proposal.pdf" }, db);
    expect(proposal).toMatchObject({ documentId: null, docKind: null, kind: "upload", source: "file", name: "Proposal.pdf", mime: "application/pdf", size: proposalBytes.length });

    const draft = await saveDraft(jobId, { subject: "your onboarding, timed", body: GOOD_BODY, attachments: [{ documentId: base.document.id }, { documentId: letter.document.id }, { fileId: proposal.fileId! }] }, db);
    expect(draft.attachments.map((a) => [a.docKind, a.source])).toEqual([["resume", "file"], ["cover_letter", "pdf"], [null, "file"]]);

    const sent = await go(jobId);
    const files = sentMessage().attachments!;
    expect(files.map((f) => f.filename)).toEqual(["base-resume.docx", "Jane Doe - Acme1 - Data Engineer 1 - Cover letter.pdf", "Proposal.pdf"]);
    expect(files[2].content.equals(proposalBytes)).toBe(true);
    expect(sent.attachments.map((a) => a.name)).toEqual(files.map((f) => f.filename));
    expect((await listSent(jobId, db))[0].attachments.map((a) => a.documentId)).toEqual([base.document.id, letter.document.id, null]);

    // Every library version that went out is locked; the uploaded file can be opened from the history.
    expect((await latestVersion(base.document.id, db))?.lockedAt).not.toBeNull();
    expect((await latestVersion(letter.document.id, db))?.lockedAt).not.toBeNull();
    expect(await isKnownResumeFile(proposal.fileId!, db)).toBe(true);
    // The uploaded file belongs to the email, not the library.
    expect(await db.select().from(documents).where(eq(documents.kind, "resume"))).toHaveLength(1);
  });

  it("offers cover letters after resumes, this job's first", async () => {
    await baseResume();
    const jobA = await seedJob(1);
    const jobB = await seedJob(2);
    await coverLetter(jobB);
    await coverLetter(jobA);
    await libraryResume("Other resume", "text only", false);
    const options = await attachmentOptions(jobA, db);
    expect(options.map((o) => [o.kind, o.docKind])).toEqual([
      ["base", "resume"],
      ["job", "cover_letter"],
      ["past", "resume"],
      ["past", "cover_letter"],
    ]);
  });

  it("keeps the order, drops repeats, and keeps a prepared PDF when other attachments change", async () => {
    await baseResume();
    const { jobId } = await ready();
    const letter = await coverLetter(jobId);
    const base = (await getDraft(jobId, db))!.attachments[0];
    await saveDraft(jobId, { subject: "s", body: "b", attachments: [{ documentId: letter.document.id }, { documentId: base.documentId! }, { documentId: letter.document.id }] }, db);
    const prepared = await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    expect(prepared.map((p) => p.documentId)).toEqual([letter.document.id, base.documentId]);

    const proposal = await uploadAttachmentForJob(jobId, { bytes: proposalBytes, name: "Proposal.pdf" }, db);
    const draft = await saveDraft(jobId, { subject: "s", body: "b", attachments: [{ fileId: proposal.fileId! }, { documentId: letter.document.id }] }, db);
    expect(draft.attachments.map((a) => a.name)).toEqual(["Proposal.pdf", "Jane Doe - Acme1 - Data Engineer 1 - Cover letter.pdf"]);
    // The cover letter's PDF was kept: the draft still shows its real size.
    expect(draft.attachments[1]).toMatchObject({ fileId: prepared[0].fileId, size: prepared[0].size });
    await prepareAttachments(jobId, { pdf: fakePdf, storageDir: dir }, db);
    expect(fakePdf).toHaveBeenCalledOnce();
    expect(await db.select().from(outreachAttachments)).toHaveLength(2);
  });

  it("copies every attachment when a sent email is reused", async () => {
    const base = await baseResume();
    const { jobId } = await ready();
    const proposal = await uploadAttachmentForJob(jobId, { bytes: proposalBytes, name: "Proposal.pdf" }, db);
    await saveDraft(jobId, { subject: "your onboarding, timed", body: GOOD_BODY, attachments: [{ documentId: base.document.id }, { fileId: proposal.fileId! }] }, db);
    const sent = await go(jobId);
    const draft = await reuseAsDraft(jobId, sent.id, db);
    expect(draft.attachments.map((a) => a.documentId ?? a.fileId)).toEqual([base.document.id, proposal.fileId]);
  });

  it("refuses attachments that add up to more than 5 MB, and warns about each big one", async () => {
    const { jobId } = await ready([]);
    const big = (n: number) => uploadAttachmentForJob(jobId, { bytes: Buffer.concat([Buffer.from("%PDF-1.4 "), Buffer.alloc(n, n % 7)]), name: `big-${n}.pdf` }, db);
    const a = await big(3 * 1024 * 1024);
    const b = await big(2_900_000);
    await saveDraft(jobId, { subject: "your onboarding, timed", body: GOOD_BODY, attachments: [{ fileId: a.fileId! }, { fileId: b.fileId! }] }, db);
    await expect(go(jobId)).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(/add up to 5\.[0-9] MB/) });

    await saveDraft(jobId, { subject: "your onboarding, timed", body: GOOD_BODY, attachments: [{ fileId: a.fileId! }] }, db);
    const err = await go(jobId).then(() => null, (e: OutreachError) => e);
    expect(err?.needs?.find((w) => w.code === "big_attachment")?.message).toMatch(/"big-3145728\.pdf" \(3\.0 MB\) is over 1 MB/);
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts common document and image files for upload, and refuses anything else", async () => {
    const jobId = await seedJob();
    const up = (name: string, bytes: Buffer) => uploadAttachmentForJob(jobId, { bytes, name }, db);
    expect((await up("notes.txt", Buffer.from("Plain notes"))).mime).toBe("text/plain");
    expect((await up("Proposal.md", Buffer.from("# Proposal"))).mime).toBe("text/markdown");
    expect((await up("shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]))).mime).toBe("image/png");
    expect((await up("deck.docx", await makeDocx(["Deck"]))).mime).toBe(DOCX_MIME);
    await expect(up("page.html", Buffer.from("<html></html>"))).rejects.toThrow(/cannot be attached/);
    await expect(up("tool.exe", Buffer.from("MZ"))).rejects.toThrow(/cannot be attached/);
    await expect(up("fake.pdf", Buffer.from("not a pdf"))).rejects.toThrow(/does not look like a \.pdf/);
    await expect(up("binary.txt", Buffer.from([0x00, 0x01]))).rejects.toThrow(/does not look like a \.txt/);
    await expect(up("empty.pdf", Buffer.alloc(0))).rejects.toThrow(/empty/);
    await expect(up("huge.pdf", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(6 * 1024 * 1024)]))).rejects.toThrow(/larger than 5 MB/);
    await expect(uploadAttachmentForJob("00000000-0000-4000-8000-000000000000", { bytes: proposalBytes, name: "p.pdf" }, db)).rejects.toMatchObject({ code: "not_found" });
  });

  it("caps the number of attachments", async () => {
    const jobId = await seedJob();
    const refs: AttachmentRef[] = [];
    for (let i = 0; i < 11; i++) refs.push({ fileId: (await uploadAttachmentForJob(jobId, { bytes: Buffer.from(`note ${i}`), name: `n${i}.txt` }, db)).fileId! });
    await expect(saveDraft(jobId, { subject: "s", body: "b", attachments: refs }, db)).rejects.toThrow(/at most 10/);
  });
});
