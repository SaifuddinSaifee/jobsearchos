import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

import { applyReviewedProposal, dismissProposal, getOpenReview } from "@/lib/career/review";
import { addLinkedInSource, cleanLinkedInText, LinkedInError } from "@/lib/career/linkedin";
import { claimNextProposal, enqueueProfileSource, offerProfileToRecord, processProposal, startBuild } from "@/lib/career/queue";
import { currentRecord, saveRecordVersion } from "@/lib/career/service";
import { emptyRecord } from "@/lib/career/schema";
import { careerProposals, careerSources } from "@/lib/db/schema";
import { saveVersion as saveProfile } from "@/lib/profile/service";
import { emptyProfile } from "@/lib/profile/schema";
import { counter, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

/** What the text of a LinkedIn print looks like: page furniture, buttons, counts, endorsements and doubled lines. */
const PRINT = `10/13/26, 3:00 PM
(3) Jane Doe - Product Manager - Acme | LinkedIn
Skip to search
Skip to main content
Close jump menu
Home
My Network
Jobs
Messaging
Notifications
Me
For Business
Try Premium for free
Jane Doe
Jane Doe
Product Manager at Acme Inc.
Product Manager at Acme Inc.
Pune, Maharashtra, India  Contact info
500+ connections
1,234 followers
Message
Connect
More
About
I turn messy problems into shipped products, from billing platforms to onboarding flows.
...see more
Experience
Product Manager
Product Manager
Acme Inc. · Full-time
Acme Inc. · Full-time
Jan 2020 - Dec 2021 · 2 yrs
Pune
Launched self-serve onboarding to 10,000 users
Show all 4 experiences
https://www.linkedin.com/in/jane-doe-123/ 1/3
Page 2 of 3
Skills
TypeScript
Endorsed by 3 colleagues at Acme
12 endorsements
Show all 18 skills`;

describe("cleanLinkedInText", () => {
  const cleaned = cleanLinkedInText(PRINT);

  it("removes navigation, buttons, counts, endorsements and the browser's page furniture", () => {
    for (const gone of [
      "| LinkedIn",
      "Skip to search",
      "My Network",
      "Try Premium",
      "500+ connections",
      "1,234 followers",
      "Message",
      "Connect",
      "see more",
      "Show all 4 experiences",
      "Show all 18 skills",
      "Page 2 of 3",
      "https://www.linkedin.com",
      "10/13/26, 3:00 PM",
      "Endorsed by",
      "12 endorsements",
    ]) {
      expect(cleaned).not.toContain(gone);
    }
  });

  it("keeps the profile word for word, with lines LinkedIn printed twice kept once", () => {
    expect(cleaned.match(/^Jane Doe$/gm)).toHaveLength(1);
    expect(cleaned.match(/^Product Manager$/gm)).toHaveLength(1);
    expect(cleaned).toContain("Product Manager at Acme Inc.");
    expect(cleaned).toContain("Acme Inc. · Full-time");
    expect(cleaned).toContain("Jan 2020 - Dec 2021 · 2 yrs");
    expect(cleaned).toContain("Launched self-serve onboarding to 10,000 users");
    expect(cleaned).toContain("I turn messy problems into shipped products, from billing platforms to onboarding flows.");
    expect(cleaned).toContain("TypeScript");
  });

  it("does not remove a real line that merely contains a noisy word", () => {
    const t = cleanLinkedInText("Jobs board redesign lead\nMore than 40 customers onboarded\nConnected 12 teams through one API");
    expect(t.split("\n")).toHaveLength(3);
  });

  it("is stable when run twice", () => {
    expect(cleanLinkedInText(cleaned)).toBe(cleaned);
  });
});

describe("adding a LinkedIn print", () => {
  const noGroup = async () => new Map();

  it("refuses text that is too short to be a profile", async () => {
    await expect(addLinkedInSource("Home\nMy Network\nJobs", db)).rejects.toBeInstanceOf(LinkedInError);
    expect(await db.select().from(careerSources)).toEqual([]);
  });

  it("keeps only the cleaned text, queues it, and reads it with the model when it is prepared", async () => {
    const out = await addLinkedInSource(PRINT, db, new Date(Date.UTC(2026, 9, 13)));
    expect(out.status).toBe("queued");
    const [source] = await db.select().from(careerSources);
    expect(source).toMatchObject({ kind: "linkedin", label: "LinkedIn profile, Oct 2026", documentVersionId: null, profileVersionId: null });
    expect(source.text).toBe(cleanLinkedInText(PRINT));
    expect(source.text).not.toContain("Skip to search");

    const parse = vi.fn(async (text: string) => {
      expect(text).toBe(source.text);
      return profileWith([{ company: "Acme Inc.", title: "Product Manager", start: "Jan 2020", end: "Dec 2021", location: "Pune", bullets: ["Launched self-serve onboarding to 10,000 users"] }]);
    });
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse, grouper: noGroup });
    expect(parse).toHaveBeenCalledOnce();
    const review = (await getOpenReview(db))!;
    expect(review.source).toMatchObject({ kind: "linkedin", label: "LinkedIn profile, Oct 2026" });
    expect(review.source.text).toBe(source.text);
    expect(review.proposal.employers[0].roles[0].bullets[0].text).toBe("Launched self-serve onboarding to 10,000 users");

    await applyReviewedProposal(id, { db, newId: counter("n") });
    const record = (await currentRecord(db)).record;
    expect(record.employers[0].roles[0].facts[0].wordings[0].sources[0].sourceId).toBe(source.id);
  });

  it("does not make a second source for the same text, and skips it once it is in the record", async () => {
    const first = await addLinkedInSource(PRINT, db);
    const again = await addLinkedInSource(PRINT, db);
    expect(again).toMatchObject({ status: "open", proposalId: (first as { proposalId: string }).proposalId });
    expect(await db.select().from(careerSources)).toHaveLength(1);

    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: async () => profileWith([{ bullets: ["x"] }]), grouper: noGroup });
    await applyReviewedProposal(id, { db, newId: counter("n") });
    expect(await addLinkedInSource(PRINT, db)).toMatchObject({ status: "skipped", reason: "Already in your record." });
    expect(await db.select().from(careerSources)).toHaveLength(1);
  });

  it("does not queue a print the user left out", async () => {
    const out = await addLinkedInSource(PRINT, db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: async () => profileWith([{ bullets: ["x"] }]), grouper: noGroup });
    await dismissProposal(id, db);
    expect(out.status).toBe("queued");
    expect(await addLinkedInSource(PRINT, db)).toMatchObject({ status: "skipped", reason: "You left this out of your record." });
  });

  it("treats a changed print as a new source", async () => {
    await addLinkedInSource(PRINT, db);
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: async () => profileWith([{ bullets: ["x"] }]), grouper: noGroup });
    await applyReviewedProposal(id, { db, newId: counter("n") });
    const out = await addLinkedInSource(`${PRINT}\nNew line about a promotion to senior product manager at Acme`, db);
    expect(out.status).toBe("queued");
    expect(await db.select().from(careerSources)).toHaveLength(2);
  });

  it("is queued after the Profile", async () => {
    await saveProfile({ profile: { ...emptyProfile(), achievements: ["Won an award"] } }, db);
    await addLinkedInSource(PRINT, db);
    await startBuild(db);
    const order: string[] = [];
    for (;;) {
      const id = await claimNextProposal(db);
      if (!id) break;
      await processProposal(id, { db, parse: async () => profileWith([]), grouper: noGroup });
      const [row] = await db.select().from(careerProposals).where(eq(careerProposals.id, id));
      const [src] = await db.select().from(careerSources).where(eq(careerSources.id, row.sourceId));
      order.push(src.kind);
      await dismissProposal(id, db);
    }
    expect(order).toEqual(["profile", "linkedin"]);
  });
});

describe("the Profile as a source", () => {
  it("is only offered after a save once a career record exists", async () => {
    await saveProfile({ profile: { ...emptyProfile(), achievements: ["Won an award"] } }, db);
    expect(await offerProfileToRecord(db)).toBeNull();
    expect(await db.select().from(careerSources)).toEqual([]);

    await saveRecordVersion({ record: emptyRecord(), reason: "edit" }, db);
    expect(await offerProfileToRecord(db)).toMatchObject({ status: "queued" });
    expect(await offerProfileToRecord(db)).toMatchObject({ status: "open" });
  });

  it("is skipped while it is empty", async () => {
    await saveProfile({ profile: emptyProfile() }, db);
    expect(await enqueueProfileSource(db)).toBeNull();
  });

  it("is queued once per content, whatever else changed in the profile versions", async () => {
    const profile = { ...emptyProfile(), achievements: ["Won an award"] };
    await saveProfile({ profile }, db);
    expect((await enqueueProfileSource(db))?.status).toBe("queued");
    const id = (await claimNextProposal(db))!;
    await processProposal(id, { db, parse: async () => profileWith([]), grouper: async () => new Map() });
    await applyReviewedProposal(id, { db, newId: counter("n") });

    // A new profile version that only changes preferences has the same profile content.
    await saveProfile({ changeNote: "Only a note changed" }, db);
    expect(await enqueueProfileSource(db)).toMatchObject({ status: "skipped" });

    await saveProfile({ profile: { ...profile, achievements: ["Won an award", "Spoke at a conference"] } }, db);
    expect((await enqueueProfileSource(db))?.status).toBe("queued");
  });
});
