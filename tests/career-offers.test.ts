import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
// Any model call would fail: the summary, the choices and the one-click add must work without one.
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));
const { kick } = vi.hoisted(() => ({ kick: vi.fn() }));
vi.mock("@/lib/queue/worker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/queue/worker")>()), kickWorker: kick }));

import { getDocumentOffer, listDocumentOffers, setRecordChoice, type DocumentOffer } from "@/lib/career/offer";
import { describeSummary } from "@/lib/career/offer-summary";
import { addDocumentsToRecord, claimNextProposal, processProposal } from "@/lib/career/queue";
import { dismissProposal, getOpenReview, skipProposal } from "@/lib/career/review";
import { currentRecord } from "@/lib/career/service";
import { careerProposals, careerSources, resumeIndexes } from "@/lib/db/schema";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { enqueueAfterCreate } from "@/lib/documents/queue";
import { createDocument, createVersion, saveDraft, softDelete } from "@/lib/documents/service";
import { processCareer, processIndex } from "@/lib/queue/worker";
import { counter, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(async () => {
  await resetDb(db);
  kick.mockClear();
});
afterAll(() => db.$client.end());

const noGroup = async () => new Map();
const never = async () => {
  throw new Error("the model must not be called");
};
/** Prepares a proposal the way the worker does, with no model, then applies it if it was a one-click add. */
const prepare = (id: string) => processCareer(id, { db, run: (pid) => processProposal(pid, { db, parse: never, grouper: noGroup }) });

/** Block ids differ between documents, as in real ones: the same id would mean "the same bullet, edited". */
const blockIds = counter("b");
const eng = (bullets: string[], over: Parameters<typeof profileWith>[0][number] = {}) =>
  profileToDoc(profileWith([{ company: "Acme", title: "Software Engineer", start: "Jan 2020", end: "Dec 2022", bullets, ...over }]), blockIds);

async function resume(title: string, bullets: string[], opts: { isBase?: boolean; writtenOn?: string; over?: Parameters<typeof profileWith>[0][number] } = {}) {
  return createDocument({ kind: "resume", origin: "uploaded", title, content: eng(bullets, opts.over), isBase: opts.isBase, writtenOn: opts.writtenOn }, db);
}

const LETTER = "I would love to work on this team because the problems you are solving matter to me a great deal.";
async function letter(title: string, text = LETTER) {
  return createDocument({ kind: "cover_letter", origin: "pasted", title, content: textToDoc(text, { mode: "letter" }) }, db);
}

/** A record holding the base resume, added with one click. */
async function recordWithBase() {
  const base = await resume("Base", ["Built the billing service", "Cut build times by 40%"], { isBase: true });
  await addDocumentsToRecord([base.document.id], { autoApply: true }, db);
  await prepare((await claimNextProposal(db))!);
  return base;
}

async function newVersion(documentId: string, content: ReturnType<typeof eng>) {
  const [{ rev }] = await db.execute<{ rev: number }>(sql`SELECT revision AS rev FROM document_drafts WHERE document_id = ${documentId}`);
  await saveDraft(documentId, { content, revision: rev }, db);
  return (await createVersion(documentId, { reason: "manual" }, db)).version;
}

const offerOf = async (id: string) => (await getDocumentOffer(id, db))!;
const summaryOf = (o: DocumentOffer) => {
  if (o.state !== "new") throw new Error(`expected a new offer, got ${o.state}`);
  return o.summary;
};

describe("saving a document", () => {
  it("never queues it for the record, even once a record exists", async () => {
    await recordWithBase();
    const r = await resume("New resume", ["A different accomplishment"]);
    const l = await letter("Letter");
    await enqueueAfterCreate(r.document.id, db);
    await enqueueAfterCreate(l.document.id, db);
    expect(await db.select().from(careerProposals).where(sql`status <> 'applied'`)).toEqual([]);
  });

  it("does not offer it when reading the upload into sections finishes", async () => {
    await recordWithBase();
    const { document, version } = await resume("Uploaded", ["A different accomplishment"]);
    await enqueueAfterCreate(document.id, db);
    const [idx] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, version.id));
    await processIndex(idx.id, { db });
    expect(await db.select().from(careerProposals).where(sql`status <> 'applied'`)).toEqual([]);
  });
});

describe("the free summary", () => {
  it("counts everything as new before a record exists", async () => {
    const { document } = await resume("A", ["One thing", "Another thing"]);
    const s = summaryOf(await offerOf(document.id));
    expect(s.bullets).toEqual({ total: 2, inRecord: 0, reworded: 0, fresh: 2 });
    expect(s.newEmployers).toBe(1);
    expect(s.newRoles).toEqual([{ title: "Software Engineer", company: "Acme", dates: "Jan 2020 to Dec 2022" }]);
  });

  it("says what is already in the record and what is new, in words", async () => {
    await recordWithBase();
    const { document } = await resume("Tailored", ["Built the billing service", "Something brand new"]);
    const s = summaryOf(await offerOf(document.id));
    expect(s.bullets).toEqual({ total: 2, inRecord: 1, reworded: 0, fresh: 1 });
    expect(s.newRoles).toEqual([]);
    expect(describeSummary(s, "resume")).toBe("1 of 2 bullets are already in your record. New: 1 bullet.");

    const other = await resume("Other job", ["Ran the team"], { over: { company: "Initech", start: "2019", end: "2020" } });
    expect(describeSummary(summaryOf(await offerOf(other.document.id)), "resume")).toBe(
      "Its one bullet is not in your record word for word. New: 1 bullet and a job (Software Engineer at Initech, 2019 to 2020).",
    );
  });

  it("is nothing new when everything is already there, in any order", async () => {
    await recordWithBase();
    const dup = await resume("Reordered", ["Cut build times by 40%", "Built the billing service"]);
    expect((await offerOf(dup.document.id)).state).toBe("nothing-new");
  });

  it("is in the record once added, and so is a copy with the same content", async () => {
    const base = await recordWithBase();
    expect((await offerOf(base.document.id)).state).toBe("in-record");
    const copy = await createDocument({ kind: "resume", origin: "uploaded", title: "Copy", content: base.version.content }, db);
    expect((await offerOf(copy.document.id)).state).toBe("in-record");
  });

  it("counts cover letter paragraphs without the model", async () => {
    const l = await letter("Letter");
    const o = await offerOf(l.document.id);
    expect(summaryOf(o).paragraphs).toEqual({ total: 1, inRecord: 0 });
    expect(describeSummary(summaryOf(o), "cover_letter")).toBe(
      "Its one paragraph is not in your record yet. The AI sorts it into stories and reasons for applying when you add it.",
    );
  });

  it("waits for an upload being read, and says the AI will read one with no sections when it is added", async () => {
    const text = "Jane Doe. Software engineer with ten years of experience building payment systems and leading teams.";
    const d = await createDocument({ kind: "resume", origin: "pasted", title: "Plain", content: textToDoc(text) }, db);
    await db.insert(resumeIndexes).values({ documentVersionId: d.version.id, status: "running" });
    expect((await offerOf(d.document.id)).state).toBe("reading");
    await db.update(resumeIndexes).set({ status: "failed" }).where(eq(resumeIndexes.documentVersionId, d.version.id));
    expect(summaryOf(await offerOf(d.document.id)).needsReading).toBe(true);
  });

  it("leaves out emails, deleted documents and documents with nothing to read", async () => {
    const email = await createDocument({ kind: "email", origin: "pasted", title: "Mail", content: textToDoc("Hello there, how are you doing today my friend", { mode: "letter" }) }, db);
    const gone = await resume("Gone", ["Some work"]);
    await softDelete(gone.document.id, db);
    expect(await getDocumentOffer(email.document.id, db)).toBeNull();
    expect(await getDocumentOffer(gone.document.id, db)).toBeNull();
    const blank = await createDocument({ kind: "resume", origin: "blank", title: "Blank", content: profileToDoc(profileWith([])) }, db);
    const empty = await letter("Empty letter", "Dear team,\n\nThanks,\nJane");
    expect((await offerOf(blank.document.id)).state).toBe("empty");
    expect((await offerOf(empty.document.id)).state).toBe("empty");
  });

  it("lists the base resume first, then resumes newest first, then cover letters", async () => {
    await letter("Letter");
    await resume("Old", ["Old work"], { writtenOn: "2020-01-01" });
    await resume("New", ["New work"], { writtenOn: "2024-01-01" });
    await resume("Base", ["Base work"], { isBase: true, writtenOn: "2018-01-01" });
    expect((await listDocumentOffers(db)).map((o) => o.title)).toEqual(["Base", "New", "Old", "Letter"]);
  });
});

describe("Not now and Never", () => {
  it("Not now holds for this version only", async () => {
    const { document } = await resume("A", ["One thing"]);
    await setRecordChoice(document.id, "later", db);
    expect((await offerOf(document.id)).choice).toBe("later");
    await newVersion(document.id, eng(["One thing", "And another"]));
    expect((await offerOf(document.id)).choice).toBeNull();
  });

  it("Never holds for every version, until the user asks again or adds it", async () => {
    const { document } = await resume("A", ["One thing"]);
    await setRecordChoice(document.id, "never", db);
    await newVersion(document.id, eng(["One thing", "And another"]));
    expect((await offerOf(document.id)).choice).toBe("never");
    await setRecordChoice(document.id, null, db);
    expect((await offerOf(document.id)).choice).toBeNull();

    await setRecordChoice(document.id, "never", db);
    await addDocumentsToRecord([document.id], {}, db);
    expect((await offerOf(document.id)).choice).toBeNull();
  });

  it("is refused for an email", async () => {
    const email = await createDocument({ kind: "email", origin: "pasted", title: "Mail", content: textToDoc("Hello there, how are you doing today my friend", { mode: "letter" }) }, db);
    await expect(setRecordChoice(email.document.id, "never", db)).rejects.toThrow(/not a resume or cover letter/);
  });
});

describe("adding to the record", () => {
  it("adds the chosen documents with one click, one after another, with no review", async () => {
    const a = await resume("A", ["One thing"], { writtenOn: "2020-01-01" });
    const b = await resume("B", ["Another thing"], { writtenOn: "2024-01-01" });
    expect(await addDocumentsToRecord([a.document.id, b.document.id], { autoApply: true }, db)).toEqual({ queued: 2, open: 0, skipped: 0 });
    expect(kick).not.toHaveBeenCalled();

    const first = (await claimNextProposal(db))!;
    const [src] = await db.select().from(careerSources).innerJoin(careerProposals, eq(careerProposals.sourceId, careerSources.id)).where(eq(careerProposals.id, first));
    expect(src.career_sources.label).toBe("B");
    expect((await offerOf(b.document.id)).state).toBe("adding");
    await prepare(first);
    expect((await offerOf(b.document.id)).state).toBe("in-record");
    expect(await getOpenReview(db)).toBeNull();

    await prepare((await claimNextProposal(db))!);
    expect((await offerOf(a.document.id)).state).toBe("in-record");
    const { record, version } = await currentRecord(db);
    expect(version).toBe(2);
    expect(record.employers[0].roles[0].facts.map((f) => f.wordings[0].text).sort()).toEqual(["Another thing", "One thing"]);
  });

  it("waits for review when the user chose to review first", async () => {
    const { document } = await resume("A", ["One thing"]);
    await addDocumentsToRecord([document.id], { autoApply: false }, db);
    await prepare((await claimNextProposal(db))!);
    expect((await offerOf(document.id)).state).toBe("review");
    expect(await getOpenReview(db)).not.toBeNull();
  });

  it("turns a queued add into a one-click add", async () => {
    const { document } = await resume("A", ["One thing"]);
    await addDocumentsToRecord([document.id], { autoApply: false }, db);
    expect(await addDocumentsToRecord([document.id], { autoApply: true }, db)).toEqual({ queued: 0, open: 1, skipped: 0 });
    await prepare((await claimNextProposal(db))!);
    expect((await offerOf(document.id)).state).toBe("in-record");
  });

  it("does not offer again what was left out in review, but adds it when asked", async () => {
    const { document } = await resume("A", ["One thing"]);
    await addDocumentsToRecord([document.id], {}, db);
    const id = (await claimNextProposal(db))!;
    await prepare(id);
    await dismissProposal(id, db);
    expect((await offerOf(document.id)).state).toBe("left-out");
    expect((await listDocumentOffers(db)).filter((o) => o.state === "new")).toEqual([]);

    expect((await addDocumentsToRecord([document.id], { autoApply: true }, db)).queued).toBe(1);
    await prepare((await claimNextProposal(db))!);
    expect((await offerOf(document.id)).state).toBe("in-record");
  });

  it("queues a source set aside before review again", async () => {
    const { document } = await resume("A", ["One thing"]);
    await addDocumentsToRecord([document.id], {}, db);
    const id = (await claimNextProposal(db))!;
    await skipProposal(id, db);
    expect((await offerOf(document.id)).state).toBe("set-aside");
    await addDocumentsToRecord([document.id], { autoApply: true }, db);
    expect(await claimNextProposal(db)).toBe(id);
  });

  it("leaves out a source set aside before review, and does not offer it again", async () => {
    const { document } = await resume("A", ["One thing"]);
    await addDocumentsToRecord([document.id], {}, db);
    const id = (await claimNextProposal(db))!;
    await skipProposal(id, db);
    await dismissProposal(id, db);
    expect((await offerOf(document.id)).state).toBe("left-out");
    expect((await listDocumentOffers(db)).filter((o) => o.state === "new")).toEqual([]);
  });

  it("skips what is already in the record", async () => {
    const base = await recordWithBase();
    expect(await addDocumentsToRecord([base.document.id], { autoApply: true }, db)).toEqual({ queued: 0, open: 0, skipped: 1 });
  });

  it("leaves out a source that turns out to add nothing, without holding up the queue", async () => {
    await recordWithBase();
    const dup = await resume("Reordered", ["Cut build times by 40%", "Built the billing service"]);
    await addDocumentsToRecord([dup.document.id], { autoApply: true }, db);
    const id = (await claimNextProposal(db))!;
    await prepare(id);
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row).toMatchObject({ status: "dismissed", note: expect.stringContaining("Nothing new") });
    expect(await claimNextProposal(db)).toBeNull();
  });
});
