import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { careerProposals, careerSources } from "@/lib/db/schema";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument, createVersion, saveDraft, softDelete } from "@/lib/documents/service";
import { saveVersion as saveProfileVersion } from "@/lib/profile/service";
import { emptyProfile } from "@/lib/profile/schema";
import { resolveCompany } from "@/lib/companies/service";
import {
  claimNextProposal,
  enqueueDocumentSource,
  enqueueProfileSource,
  processProposal,
  recoverInterruptedProposals,
  startBuild,
  sweepStaleProposals,
} from "@/lib/career/queue";
import {
  applyReviewedProposal,
  dismissProposal,
  getCareerStatus,
  getOpenReview,
  prepareSkipped,
  ProposalError,
  retryProposal,
  reviewAgain,
  saveDecisions,
  skipProposal,
} from "@/lib/career/review";
import { currentRecord, restoreRecordVersion, saveRecordVersion } from "@/lib/career/service";
import { emptyRecord } from "@/lib/career/schema";
import { regroupRole } from "@/lib/career/review";
import { currentAbortSignal } from "@/lib/llm/abort";
import { processCareer } from "@/lib/queue/worker";
import { counter, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const newId = counter("rid");
/** No model: bullets that match nothing exactly stay new facts. */
const noGroup = async () => new Map();
const never = async () => {
  throw new Error("the model must not be called");
};

async function resume(title: string, experience: Parameters<typeof profileWith>[0], opts: { isBase?: boolean; writtenOn?: string } = {}) {
  return createDocument(
    { kind: "resume", origin: "uploaded", title, content: profileToDoc(profileWith(experience), counter("b")), ...opts },
    db,
  );
}

const acmeEng = [{ company: "Acme", title: "Software Engineer", bullets: ["Built the billing service", "Cut build times by 40%"] }];
const acmePm = [{ company: "Acme", title: "Product Manager", bullets: ["Launched self-serve onboarding", "Cut build times by 40%"] }];

/** Claims and prepares the next proposal, returning its id. */
async function prepareNext() {
  const id = await claimNextProposal(db);
  if (!id) return null;
  await processProposal(id, { db, parse: never, grouper: noGroup });
  return id;
}

describe("starting a build", () => {
  it("queues the base resume first, then the others newest first, then the profile", async () => {
    await resume("Old", acmeEng, { writtenOn: "2020-01-01" });
    await resume("New", acmePm, { writtenOn: "2024-01-01" });
    await resume("Base", acmeEng, { isBase: true, writtenOn: "2018-01-01" });
    await saveProfileVersion({ profile: { ...emptyProfile(), achievements: ["Won an award"] } }, db);
    const out = await startBuild(db);
    expect(out).toEqual({ queued: 4, skipped: 0 });

    const order: string[] = [];
    for (;;) {
      const id = await prepareNext();
      if (!id) break;
      const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
      const [src] = await db.select().from(careerSources).where(eq(careerSources.id, row.sourceId));
      order.push(src.label);
      // Each one stays ready until reviewed, so the next claim returns nothing: dismiss to move on.
      await dismissProposal(id, db);
    }
    expect(order).toEqual(["Base", "New", "Old", "Profile"]);
  });

  it("skips an empty profile, deleted documents and emails", async () => {
    await saveProfileVersion({ profile: emptyProfile() }, db);
    const doc = await resume("Gone", acmeEng);
    await softDelete(doc.document.id, db);
    await createDocument({ kind: "email", origin: "pasted", title: "Mail", content: textToDoc("Hello there", { mode: "letter" }) }, db);
    expect(await startBuild(db)).toEqual({ queued: 0, skipped: 0 });
    expect(await enqueueProfileSource(db)).toBeNull();
  });

  it("is safe to run twice", async () => {
    await resume("A", acmeEng);
    await startBuild(db);
    expect(await startBuild(db)).toEqual({ queued: 0, skipped: 0 });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(careerProposals);
    expect(n).toBe(1);
  });
});

describe("one proposal at a time", () => {
  it("claims nothing while one is running or waiting for review", async () => {
    await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    const first = await claimNextProposal(db);
    expect(first).toBeTruthy();
    expect(await claimNextProposal(db)).toBeNull();
    await processProposal(first!, { db, parse: never, grouper: noGroup });
    expect(await claimNextProposal(db)).toBeNull();
    await dismissProposal(first!, db);
    expect(await claimNextProposal(db)).toBeTruthy();
  });

  it("requeues a running proposal whose worker stopped, and fails it after too many tries", async () => {
    await resume("A", acmeEng);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await db.execute(sql`UPDATE career_proposals SET updated_at = now() - interval '10 minutes' WHERE id = ${id}`);
    expect(await sweepStaleProposals(db)).toBe(1);
    expect((await db.select().from(careerProposals))[0].status).toBe("queued");

    await db.execute(sql`UPDATE career_proposals SET status = 'running', attempts = 3, updated_at = now() - interval '10 minutes'`);
    await sweepStaleProposals(db);
    const [row] = await db.select().from(careerProposals);
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/too many times/);
    await retryProposal(row.id, db);
    expect((await db.select().from(careerProposals))[0]).toMatchObject({ status: "queued", error: null, attempts: 0 });
  });

  it("puts back every running proposal at startup, however recent, and fails it after too many tries", async () => {
    await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    expect(await sweepStaleProposals(db)).toBe(0);
    expect(await recoverInterruptedProposals(db)).toBe(1);
    expect((await db.select().from(careerProposals).where(eq(careerProposals.id, id)))[0]).toMatchObject({ status: "queued", startedAt: null });

    await db.execute(sql`UPDATE career_proposals SET status = 'running', attempts = 3 WHERE id = ${id}`);
    await recoverInterruptedProposals(db);
    expect((await db.select().from(careerProposals).where(eq(careerProposals.id, id)))[0]).toMatchObject({ status: "failed" });
  });

  it("records a failure when the source cannot be read", async () => {
    const { document } = await resume("A", acmeEng);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await db.execute(sql`UPDATE career_sources SET document_version_id = NULL, text = 'x', kind = 'linkedin' WHERE document_id = ${document.id}`);
    await processProposal(id, {
      db,
      parse: async () => {
        throw new Error("model is down");
      },
    });
    const [row] = await db.select().from(careerProposals);
    expect(row).toMatchObject({ status: "failed", error: "model is down" });
  });
});

describe("the worker", () => {
  it("marks a proposal failed when preparing it throws or takes too long", async () => {
    await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    const first = (await claimNextProposal(db))!;
    await processCareer(first, {
      db,
      run: async () => {
        throw new Error("exploded");
      },
    });
    let [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, first));
    expect(row).toMatchObject({ status: "failed", error: "exploded" });

    // A failed proposal does not hold up the queue.
    const second = (await claimNextProposal(db))!;
    expect(second).not.toBe(first);
    await processCareer(second, { db, run: () => new Promise(() => {}), timeoutMs: 20 });
    [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, second));
    expect(row).toMatchObject({ status: "failed", error: "Timed out after 5 minutes" });
  });

  it("stops at once when skipped, cancelling its model calls and recording nothing", async () => {
    await resume("A", acmeEng);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const done = processCareer(id, {
      db,
      signal: controller.signal,
      run: () => {
        seen = currentAbortSignal();
        return new Promise(() => {});
      },
    });
    await skipProposal(id, db);
    controller.abort();
    await done;
    expect(seen).toBe(controller.signal);
    expect(seen!.aborted).toBe(true);
    expect((await db.select().from(careerProposals))[0].status).toBe("skipped");
  });

  it("prepares a proposal for real when nothing goes wrong", async () => {
    await resume("A", acmeEng);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await processCareer(id, { db });
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row.status).toBe("ready");
  });
});

describe("reviewing and applying", () => {
  it("prepares a proposal, applies it, and moves the queue on", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await resume("PM", acmePm, { writtenOn: "2020-01-01" });
    await startBuild(db);

    const first = (await prepareNext())!;
    const review = (await getOpenReview(db))!;
    expect(review.source).toMatchObject({ label: "Base", kind: "resume" });
    expect(review.proposal.baseVersion).toBe(0);
    expect(review.proposal.employers[0].suggestion).toEqual({ to: "new" });

    const applied = await applyReviewedProposal(first, { db, newId });
    expect(applied.version).toBe(1);
    expect(applied.summary).toMatchObject({ employersAdded: 1, rolesAdded: 1, factsAdded: 2 });
    expect((await currentRecord(db)).record.employers[0].roles[0].framings[0].title).toBe("Software Engineer");

    // The next source is prepared against the record that now has the first one.
    const second = (await prepareNext())!;
    const next = (await getOpenReview(db))!;
    expect(next.proposal.baseVersion).toBe(1);
    expect(next.proposal.employers[0].suggestion).toMatchObject({ to: "existing" });
    expect(next.proposal.employers[0].roles[0].suggestion).toMatchObject({ to: "framing" });
    await applyReviewedProposal(second, { db, newId });

    const { record, version } = await currentRecord(db);
    expect(version).toBe(2);
    expect(record.employers[0].roles).toHaveLength(1);
    expect(record.employers[0].roles[0].framings).toHaveLength(2);
    const status = await getCareerStatus(db);
    expect(status).toMatchObject({ done: 2, total: 2, current: null, recordVersion: 2 });
  });

  it("applies the choices that were saved, not the suggestions", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await startBuild(db);
    const id = (await prepareNext())!;
    const review = (await getOpenReview(db))!;
    const bullet = review.proposal.employers[0].roles[0].bullets[0];
    await saveDecisions(id, { [bullet.key]: { action: "reject" } }, db);
    expect((await getOpenReview(db))!.decisions[bullet.key].action).toBe("reject");
    await applyReviewedProposal(id, { db, newId });
    const texts = (await currentRecord(db)).record.employers[0].roles[0].facts.flatMap((f) => f.wordings.map((w) => w.text));
    expect(texts).toEqual(["Cut build times by 40%"]);
  });

  it("rejects bad decisions and decisions for a proposal that is not waiting", async () => {
    await resume("Base", acmeEng);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await expect(saveDecisions(id, {}, db)).rejects.toBeInstanceOf(ProposalError);
    await processProposal(id, { db, parse: never, grouper: noGroup });
    await expect(saveDecisions(id, { x: { action: "explode" } }, db)).rejects.toThrow();
    await saveDecisions(id, {}, db);
  });

  it("links an employer to its page in the companies directory", async () => {
    const company = await resolveCompany({ name: "Acme" }, db);
    await resume("Base", acmeEng);
    await startBuild(db);
    const id = (await prepareNext())!;
    expect((await getOpenReview(db))!.proposal.employers[0].companyId).toBe(company.id);
    await applyReviewedProposal(id, { db, newId });
    expect((await currentRecord(db)).record.employers[0].companyId).toBe(company.id);
  });

  it("reads an unstructured resume with the model and says so", async () => {
    await createDocument(
      {
        kind: "resume",
        origin: "pasted",
        title: "Plain",
        content: textToDoc("JANE DOE\n\nI built many things at Acme across a decade of work and I liked it a lot, truly so.\n\nMore text here to reach the minimum length for reading."),
      },
      db,
    );
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    const parse = vi.fn(async () => profileWith(acmeEng));
    await processProposal(id, { db, parse, grouper: noGroup });
    expect(parse).toHaveBeenCalledOnce();
    const review = (await getOpenReview(db))!;
    expect(review.note).toMatch(/Read with AI/);
    expect(review.proposal.employers[0].name).toBe("Acme");
  });
});

describe("cover letters", () => {
  const LETTER = [
    "Dear Hiring Manager,",
    "I want to join Globex because making logistics simple is the reason I moved into supply chain software in the first place.",
    "At Acme I built the billing service in Go, which now processes millions of invoices every month for hundreds of customers.",
    "Thank you for your time and consideration, and I look forward to speaking with you soon.",
  ].join("\n\n");

  it("is queued last, read with the model, and merged as a story and a reason", async () => {
    const company = await resolveCompany({ name: "Globex" }, db);
    await createDocument({ kind: "cover_letter", origin: "pasted", title: "Letter to Globex", content: textToDoc(LETTER, { mode: "letter" }), companyId: company.id, targetRole: "Software Engineer" }, db);
    await resume("Base", acmeEng, { isBase: true });
    expect(await startBuild(db)).toEqual({ queued: 2, skipped: 0 });

    await applyReviewedProposal((await prepareNext())!, { db, newId });
    const record = (await currentRecord(db)).record;
    const role = record.employers[0].roles[0];
    const billing = role.facts[0];

    const id = (await claimNextProposal(db))!;
    const classifier = vi.fn(async (paragraphs: { key: string; text: string }[], roles: { id: string; label: string }[]) => {
      expect(roles).toEqual([{ id: role.id, label: "Acme: Software Engineer, Jan 2020 - Dec 2021" }]);
      return new Map(
        paragraphs.map((p, i) => [p.key, i === 0 ? { kind: "motivation_company" as const, roleId: null } : i === 1 ? { kind: "story" as const, roleId: role.id } : { kind: "boilerplate" as const, roleId: null }]),
      );
    });
    await processProposal(id, { db, parse: never, classifier, grouper: async (_r, s) => new Map(s.map((b) => [b.key, { factId: billing.id, withKey: null }])) });
    expect(classifier).toHaveBeenCalledOnce();

    const review = (await getOpenReview(db))!;
    expect(review.source).toMatchObject({ label: "Letter to Globex", kind: "cover_letter" });
    expect(review.proposal.paragraphs.map((p) => p.suggestion.kind)).toEqual(["motivation_company", "story", "boilerplate"]);
    expect(review.proposal.paragraphs[0]).toMatchObject({ companyId: company.id, companyName: "Globex" });

    await applyReviewedProposal(id, { db, newId });
    const next = (await currentRecord(db)).record;
    expect(next.employers[0].roles[0].facts[0].wordings.map((w) => w.form)).toEqual(["bullet", "paragraph"]);
    expect(next.motivations).toMatchObject([{ scope: "company", companyName: "Globex", companyId: company.id }]);
  });

  it("fails the proposal when the letter cannot be read, so it can be retried", async () => {
    await createDocument({ kind: "cover_letter", origin: "pasted", title: "Letter", content: textToDoc(LETTER, { mode: "letter" }) }, db);
    await startBuild(db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, {
      db,
      parse: never,
      grouper: noGroup,
      classifier: async () => {
        throw new Error("Could not read the cover letter with the model: down");
      },
    });
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row).toMatchObject({ status: "failed", error: expect.stringContaining("down") });
  });
});

describe("grouping with the model", () => {
  it("puts reworded bullets on the fact they repeat, for roles that join one in the record", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await resume("PM", [{ ...acmePm[0], title: "Software Engineer", bullets: ["Designed and shipped the billing platform", "Brand new accomplishment"] }], { writtenOn: "2020-01-01" });
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });

    const record = (await currentRecord(db)).record;
    const billing = record.employers[0].roles[0].facts[0];
    const asked: string[][] = [];
    const grouper = async (_role: unknown, open: { key: string; text: string }[]) => {
      asked.push(open.map((b) => b.text));
      return new Map([[open[0].key, { factId: billing.id, withKey: null }]]);
    };
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: never, grouper });
    expect(asked).toEqual([["Designed and shipped the billing platform", "Brand new accomplishment"]]);

    const bullets = (await getOpenReview(db))!.proposal.employers[0].roles[0].bullets;
    expect(bullets[0].suggestion).toEqual({ to: "fact", factId: billing.id, why: "model" });
    expect(bullets[1].suggestion).toEqual({ to: "new" });
    await applyReviewedProposal(id, { db, newId });
    const facts = (await currentRecord(db)).record.employers[0].roles[0].facts;
    expect(facts[0].wordings.map((w) => w.text)).toEqual(["Built the billing service", "Designed and shipped the billing platform"]);
  });

  it("fails the proposal when the model cannot be reached, so it can be retried", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await resume("PM", [{ ...acmePm[0], title: "Software Engineer", bullets: ["Something reworded"] }], { writtenOn: "2020-01-01" });
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });
    const id = (await claimNextProposal(db))!;
    await processProposal(id, {
      db,
      parse: never,
      grouper: async () => {
        throw new Error("Could not group bullets with the model: down");
      },
    });
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row).toMatchObject({ status: "failed", error: expect.stringContaining("down") });
    await retryProposal(id, db);
    await processProposal((await claimNextProposal(db))!, { db, parse: never, grouper: noGroup });
    expect((await getOpenReview(db))!.proposalId).toBe(id);
  });

  it("settles a role's bullets against another role when the user moves it, and forgets old choices for them", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await resume("Other", [{ company: "Acme", title: "Manager", start: "Jan 2010", end: "Dec 2011", bullets: ["Hired the first team", "Cut build times by 40%"] }], { writtenOn: "2020-01-01" });
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });
    const id = (await prepareNext())!;
    const review = (await getOpenReview(db))!;
    const roleItem = review.proposal.employers[0].roles[0];
    expect(roleItem.suggestion).toEqual({ to: "new" });
    await saveDecisions(id, { [roleItem.bullets[0].key]: { action: "reject" }, [roleItem.key]: { action: "accept" } }, db);

    const existing = (await currentRecord(db)).record.employers[0].roles[0];
    const out = await regroupRole(id, roleItem.key, { to: "framing", roleId: existing.id }, { db, grouper: async () => new Map() });
    const bullets = out.proposal.employers[0].roles[0].bullets;
    expect(bullets[1].suggestion).toMatchObject({ to: "known" });
    expect(bullets[0].suggestion).toEqual({ to: "new" });
    expect(out.decisions[roleItem.bullets[0].key]).toBeUndefined();
    expect(out.decisions[roleItem.key]).toEqual({ action: "accept" });
    expect((await getOpenReview(db))!.proposal.employers[0].roles[0].bullets[1].suggestion).toMatchObject({ to: "known" });
    await expect(regroupRole(id, "nope", { to: "new" }, { db, grouper: async () => new Map() })).rejects.toBeInstanceOf(ProposalError);
  });
});

describe("dismissing and skipping", () => {
  it("does not queue a source that was left out, or one that is already in the record", async () => {
    const a = await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    const first = (await prepareNext())!;
    await dismissProposal(first, db);
    const second = (await prepareNext())!;
    await applyReviewedProposal(second, { db, newId });

    expect(await startBuild(db)).toEqual({ queued: 0, skipped: 2 });
    const outcome = await enqueueDocumentSource(a.document.id, db);
    expect(outcome?.status).toBe("skipped");
  });

  it("skips a different document with the same content", async () => {
    await resume("A", acmeEng);
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });
    const copy = await resume("Copy", acmeEng);
    const outcome = await enqueueDocumentSource(copy.document.id, db);
    expect(outcome).toMatchObject({ status: "skipped", reason: "Already in your record." });
  });

  it("queues a source again once its content changes", async () => {
    const a = await resume("A", acmeEng);
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });

    const edited = profileToDoc(profileWith([{ ...acmeEng[0], bullets: ["Built the billing service", "Something brand new"] }]), counter("c"));
    const [{ rev }] = await db.execute<{ rev: number }>(sql`SELECT revision AS rev FROM document_drafts WHERE document_id = ${a.document.id}`);
    await saveDraft(a.document.id, { content: edited, revision: rev }, db);
    const made = await createVersion(a.document.id, { reason: "manual" }, db);
    expect(made.created).toBe(true);
    const outcome = await enqueueDocumentSource(a.document.id, db);
    expect(outcome?.status).toBe("queued");
    await prepareNext();
    const review = (await getOpenReview(db))!;
    const bullets = review.proposal.employers[0].roles[0].bullets;
    expect(bullets.map((b) => b.suggestion.to)).toEqual(["known", "new"]);
  });
});

describe("a record that changed while reviewing", () => {
  async function setup() {
    await resume("Base", acmeEng, { isBase: true });
    await resume("PM", acmePm, { writtenOn: "2020-01-01" });
    await startBuild(db);
    await applyReviewedProposal((await prepareNext())!, { db, newId });
    return (await prepareNext())!;
  }

  it("still applies when everything it points at is there", async () => {
    const id = await setup();
    // An edit that touches something else bumps the version.
    const { record, version } = await currentRecord(db);
    const edited = structuredClone(record);
    edited.skills.push({ id: "s1", name: "Go", category: "", sources: [], provenance: { origin: "user", user: [] } });
    await saveRecordVersion({ record: edited, reason: "edit", expectedVersion: version }, db);
    const out = await applyReviewedProposal(id, { db, newId });
    expect(out.version).toBe(3);
  });

  it("queues the proposal again, keeping choices, when what it points at is gone", async () => {
    const id = await setup();
    const review = (await getOpenReview(db))!;
    await saveDecisions(id, { [review.proposal.employers[0].roles[0].bullets[0].key]: { action: "reject" } }, db);
    await saveRecordVersion({ record: emptyRecord(), reason: "edit", expectedVersion: 1 }, db);

    const err = await applyReviewedProposal(id, { db, newId }).catch((e) => e);
    expect(err).toBeInstanceOf(ProposalError);
    expect(err.stale).toBe(true);
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
    expect(row.status).toBe("queued");
    expect(Object.keys(row.decisions)).toHaveLength(1);

    const again = (await prepareNext())!;
    expect(again).toBe(id);
    const next = (await getOpenReview(db))!;
    expect(next.proposal.baseVersion).toBe(2);
    expect(next.proposal.employers[0].suggestion).toEqual({ to: "new" });
  });

  it("offers to review a merge again after it is undone by a restore", async () => {
    await resume("Base", acmeEng, { isBase: true });
    await startBuild(db);
    const id = (await prepareNext())!;
    await saveRecordVersion({ record: emptyRecord(), reason: "edit", expectedVersion: 0 }, db);
    await applyReviewedProposal(id, { db, newId });
    const [v1] = await db.execute<{ id: string }>(sql`SELECT id FROM career_record_versions WHERE version = 1`);
    await restoreRecordVersion(v1.id, db);

    const status = await getCareerStatus(db);
    expect(status.undone.map((u) => u.label)).toEqual(["Base"]);
    await reviewAgain(id, db);
    await prepareNext();
    expect((await getOpenReview(db))!.proposal.employers[0].suggestion).toEqual({ to: "new" });
  });
});

describe("skipping a source for now", () => {
  it("sets the running one aside unreviewed, moves on, and prepares it again only when asked", async () => {
    await resume("A", acmeEng, { isBase: true });
    await resume("B", acmePm);
    await startBuild(db);
    const first = (await claimNextProposal(db))!;
    expect(await skipProposal(first, db)).toEqual({ label: "A" });
    await expect(skipProposal(first, db)).rejects.toThrow(ProposalError);

    // The next one starts, and a finished run of the skipped one changes nothing.
    const second = (await claimNextProposal(db))!;
    expect(second).not.toBe(first);
    await processProposal(first, { db, parse: never, grouper: noGroup });
    expect((await db.select().from(careerProposals).where(eq(careerProposals.id, first)))[0].status).toBe("skipped");

    const status = await getCareerStatus(db);
    expect(status.skipped).toEqual([{ id: first, label: "A" }]);
    expect(status).toMatchObject({ counts: { skipped: 1, running: 1 }, total: 2, done: 0 });

    // Looking for new sources leaves it alone.
    expect(await startBuild(db)).toEqual({ queued: 0, skipped: 0 });
    await processProposal(second, { db, parse: never, grouper: noGroup });
    await dismissProposal(second, db);
    expect(await claimNextProposal(db)).toBeNull();

    await prepareSkipped(first, db);
    expect(await claimNextProposal(db)).toBe(first);
    await expect(prepareSkipped(first, db)).rejects.toThrow(ProposalError);
  });

  it("frees the review slot of one waiting for review, keeping its choices", async () => {
    await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    const first = (await prepareNext())!;
    await saveDecisions(first, { x: { action: "reject" } }, db);
    await skipProposal(first, db);
    const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, first));
    expect(row).toMatchObject({ status: "skipped", proposal: null, decisions: { x: { action: "reject" } } });
    expect(await claimNextProposal(db)).toBeTruthy();
  });

  it("replaces a skipped source when its document gets a new version", async () => {
    const { document } = await resume("A", acmeEng);
    await startBuild(db);
    const first = (await claimNextProposal(db))!;
    await skipProposal(first, db);
    const [{ rev }] = await db.execute<{ rev: number }>(sql`SELECT revision AS rev FROM document_drafts WHERE document_id = ${document.id}`);
    await saveDraft(document.id, { content: profileToDoc(profileWith(acmePm), counter("c")), revision: rev }, db);
    await createVersion(document.id, { reason: "manual" }, db);
    await enqueueDocumentSource(document.id, db);
    const rows = await db.select().from(careerProposals);
    expect(rows.find((r) => r.id === first)!.status).toBe("superseded");
    expect(rows.filter((r) => r.status === "queued")).toHaveLength(1);
  });
});

describe("career status", () => {
  it("counts proposals and reports failures", async () => {
    await resume("A", acmeEng);
    await resume("B", acmePm);
    await startBuild(db);
    expect(await getCareerStatus(db)).toMatchObject({ counts: { queued: 2 }, total: 2, done: 0, current: null });
    const id = (await claimNextProposal(db))!;
    expect((await getCareerStatus(db)).current).toMatchObject({ id, status: "running" });
    await db.update(careerProposals).set({ status: "failed", error: "boom" }).where(eq(careerProposals.id, id));
    const status = await getCareerStatus(db);
    expect(status.failed).toHaveLength(1);
    expect(status.failed[0].error).toBe("boom");
  });
});
