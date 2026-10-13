import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));
const { kick } = vi.hoisted(() => ({ kick: vi.fn() }));
vi.mock("@/lib/queue/worker", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/queue/worker")>()), kickWorker: kick }));

import { applyReviewedProposal, getOpenReview } from "@/lib/career/review";
import { claimNextProposal, offerDocumentToRecord, processProposal, startBuild } from "@/lib/career/queue";
import { saveRecordVersion } from "@/lib/career/service";
import { emptyRecord } from "@/lib/career/schema";
import { careerProposals, resumeIndexes } from "@/lib/db/schema";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { enqueueAfterCreate } from "@/lib/documents/queue";
import { createDocument, createVersion, saveDraft, softDelete } from "@/lib/documents/service";
import { processIndex } from "@/lib/queue/worker";
import { counter, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(async () => {
  await resetDb(db);
  kick.mockClear();
});
afterAll(() => db.$client.end());

const newId = counter("fid");
const noGroup = async () => new Map();
const never = async () => {
  throw new Error("the model must not be called");
};

const eng = (bullets: string[], over: Parameters<typeof profileWith>[0][number] = {}) =>
  profileToDoc(profileWith([{ company: "Acme", title: "Software Engineer", bullets, ...over }]), counter("b"));

async function resume(title: string, bullets: string[], opts: { isBase?: boolean; targetRole?: string } = {}) {
  return createDocument({ kind: "resume", origin: "uploaded", title, content: eng(bullets), ...opts }, db);
}

/** The first build, so a record exists and documents saved afterwards are offered to it. */
async function recordWithBase() {
  await resume("Base", ["Built the billing service", "Cut build times by 40%"], { isBase: true });
  await startBuild(db);
  const id = (await claimNextProposal(db))!;
  await processProposal(id, { db, parse: never, grouper: noGroup });
  await applyReviewedProposal(id, { db, newId });
}

describe("offering a document to the record", () => {
  it("does nothing until a record exists, because the first build covers everything", async () => {
    const { document } = await resume("A", ["One thing", "Another thing"]);
    expect(await offerDocumentToRecord(document.id, db)).toBeNull();
    expect(await db.select().from(careerProposals)).toEqual([]);
  });

  it("queues a new resume and a new cover letter once a record exists", async () => {
    await recordWithBase();
    const r = await resume("New resume", ["A different accomplishment"]);
    const letter = await createDocument(
      { kind: "cover_letter", origin: "pasted", title: "Letter", content: textToDoc("I would love to work on this team because the problems you are solving matter to me a great deal.", { mode: "letter" }) },
      db,
    );
    expect((await offerDocumentToRecord(r.document.id, db))?.status).toBe("queued");
    expect((await offerDocumentToRecord(letter.document.id, db))?.status).toBe("queued");
  });

  it("leaves out emails, deleted documents and documents with nothing to read", async () => {
    await recordWithBase();
    const email = await createDocument({ kind: "email", origin: "pasted", title: "Mail", content: textToDoc("Hello there, how are you doing today my friend", { mode: "letter" }) }, db);
    const gone = await resume("Gone", ["Some work"]);
    await softDelete(gone.document.id, db);
    const blank = await createDocument({ kind: "resume", origin: "blank", title: "Blank", content: profileToDoc(profileWith([])) }, db);
    const letter = await createDocument({ kind: "cover_letter", origin: "blank", title: "Empty letter", content: textToDoc("Dear team,\n\nThanks,\nJane", { mode: "letter" }) }, db);
    for (const id of [email.document.id, gone.document.id, blank.document.id, letter.document.id]) {
      expect(await offerDocumentToRecord(id, db)).toBeNull();
    }
  });

  it("waits for a resume that is still being indexed, and takes it when the index is done", async () => {
    await recordWithBase();
    const { document, version } = await resume("Uploaded", ["A different accomplishment"]);
    await db.insert(resumeIndexes).values({ documentVersionId: version.id, status: "queued" });
    expect(await offerDocumentToRecord(document.id, db)).toBeNull();

    await db.update(resumeIndexes).set({ status: "ready" }).where(eq(resumeIndexes.documentVersionId, version.id));
    expect((await offerDocumentToRecord(document.id, db))?.status).toBe("queued");
  });

  it("is offered by the worker when the index of its latest version finishes", async () => {
    await recordWithBase();
    const { document, version } = await resume("Uploaded", ["A different accomplishment"]);
    await enqueueAfterCreate(document.id, db);
    expect(await db.select().from(careerProposals).where(sql`status = 'queued'`)).toEqual([]);
    const [idx] = await db.select().from(resumeIndexes).where(eq(resumeIndexes.documentVersionId, version.id));

    await processIndex(idx.id, {
      db,
      run: async () => {
        await db.update(resumeIndexes).set({ status: "ready" }).where(eq(resumeIndexes.id, idx.id));
      },
    });
    const queued = await db.select().from(careerProposals).where(sql`status = 'queued'`);
    expect(queued).toHaveLength(1);
  });

  it("wakes the worker when something was queued", async () => {
    await recordWithBase();
    kick.mockClear();
    const letter = await createDocument(
      { kind: "cover_letter", origin: "pasted", title: "Letter", content: textToDoc("I would love to work on this team because the problems you are solving matter to me a great deal.", { mode: "letter" }) },
      db,
    );
    await enqueueAfterCreate(letter.document.id, db);
    expect(kick).toHaveBeenCalled();
  });
});

describe("a newer version replaces a pending one", () => {
  it("supersedes the older proposal of the same document", async () => {
    await recordWithBase();
    const a = await resume("Tailored", ["First accomplishment to add"]);
    await offerDocumentToRecord(a.document.id, db);
    const [first] = await db.select().from(careerProposals).where(sql`status = 'queued'`);

    const [{ rev }] = await db.execute<{ rev: number }>(sql`SELECT revision AS rev FROM document_drafts WHERE document_id = ${a.document.id}`);
    await saveDraft(a.document.id, { content: eng(["First accomplishment to add", "Second accomplishment to add"]), revision: rev }, db);
    expect((await createVersion(a.document.id, { reason: "manual" }, db)).created).toBe(true);
    await offerDocumentToRecord(a.document.id, db);

    const rows = await db.select().from(careerProposals).where(sql`status IN ('queued', 'superseded')`);
    expect(rows.find((r) => r.id === first.id)?.status).toBe("superseded");
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(1);
  });

  it("drops a pending review whose version was replaced", async () => {
    await recordWithBase();
    const a = await resume("Tailored", ["First accomplishment to add"]);
    await offerDocumentToRecord(a.document.id, db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: never, grouper: noGroup });
    expect((await getOpenReview(db))?.proposalId).toBe(id);

    const [{ rev }] = await db.execute<{ rev: number }>(sql`SELECT revision AS rev FROM document_drafts WHERE document_id = ${a.document.id}`);
    await saveDraft(a.document.id, { content: eng(["First accomplishment to add", "Second accomplishment to add"]), revision: rev }, db);
    await createVersion(a.document.id, { reason: "manual" }, db);
    await offerDocumentToRecord(a.document.id, db);

    expect(await getOpenReview(db)).toBeNull();
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row.status).toBe("superseded");
  });
});

describe("a source that adds nothing", () => {
  it("is left out without asking, with a note", async () => {
    await recordWithBase();
    // The same role and bullets in another order and another document: saving would only record a source.
    const dup = await createDocument(
      { kind: "resume", origin: "uploaded", title: "Reordered", content: eng(["Cut build times by 40%", "Built the billing service"]) },
      db,
    );
    await offerDocumentToRecord(dup.document.id, db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: never, grouper: noGroup });
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row).toMatchObject({ status: "dismissed", note: expect.stringContaining("Nothing new") });
    expect(await getOpenReview(db)).toBeNull();
    // It does not hold up the queue.
    expect(await claimNextProposal(db)).toBeNull();
  });

  it("is still shown when it adds a bullet, a framing, a role or the role it was written for", async () => {
    await recordWithBase();
    const cases: [string, ReturnType<typeof eng>, string | undefined][] = [
      ["new bullet", eng(["Built the billing service", "Something brand new"]), undefined],
      ["new framing", eng(["Built the billing service"], { title: "Product Manager" }), undefined],
      ["new role", eng(["Built the billing service"], { start: "Jan 2010", end: "Dec 2011" }), undefined],
      ["target role", eng(["Built the billing service"]), "Platform Engineer"],
    ];
    for (const [title, content, targetRole] of cases) {
      const d = await createDocument({ kind: "resume", origin: "uploaded", title, content, targetRole }, db);
      await offerDocumentToRecord(d.document.id, db);
      const id = (await claimNextProposal(db))!;
      await processProposal(id, { db, parse: never, grouper: noGroup });
      const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
      expect(row.status, title).toBe("ready");
      await db.update(careerProposals).set({ status: "dismissed" }).where(eq(careerProposals.id, id));
    }
  });

  it("is shown when nothing at all could be read from it", async () => {
    await saveRecordVersion({ record: emptyRecord(), reason: "edit" }, db);
    const d = await createDocument({ kind: "resume", origin: "pasted", title: "Odd", content: textToDoc("Some words that are long enough but have no structure at all in them, none whatsoever.") }, db);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: async () => profileWith([]), grouper: noGroup });
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row.status).toBe("ready");
    void d;
  });
});
