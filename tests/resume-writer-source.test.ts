import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { saveRecordVersion } from "@/lib/career/service";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument } from "@/lib/documents/service";
import { indexSource } from "@/lib/resume-writer/context";
import { loadContact, loadSource, mergeContact, recordFromResume } from "@/lib/resume-writer/source";
import { emptyProfile, type Profile } from "@/lib/profile/schema";
import { employer, fact, recordWith, role } from "./career-helpers";
import { counter, profileWith } from "./career-helpers";
import { resetDb, testDb } from "./helpers";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const baseContent = () =>
  profileToDoc(
    profileWith([{ company: "Initech", title: "Developer", bullets: ["Wrote the reporting tools", "Moved the nightly job to a queue"] }]),
    counter("b"),
  );

describe("recordFromResume", () => {
  it("reads a structured resume as a record, word for word, without saving anything", () => {
    const record = recordFromResume(baseContent())!;
    expect(record.employers.map((e) => e.name)).toEqual(["Initech"]);
    const facts = record.employers[0].roles[0].facts;
    expect(facts.map((f) => f.wordings[0].text)).toEqual(["Wrote the reporting tools", "Moved the nightly job to a queue"]);
    expect(indexSource(record).map((i) => i.kind)).toEqual(["fact", "fact"]);
  });

  it("is null for a resume with no sections, or none with experience", () => {
    expect(recordFromResume(textToDoc("Just a paragraph of plain text with nothing structured in it at all."))).toBeNull();
    expect(recordFromResume(profileToDoc(profileWith([]), counter("b")))).toBeNull();
  });
});

describe("loadSource", () => {
  it("is null when there is no record and no base resume", async () => {
    expect(await loadSource(db)).toBeNull();
  });

  it("uses the base resume while the record is empty", async () => {
    const base = await createDocument({ kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: baseContent() }, db);
    const loaded = (await loadSource(db))!;
    expect(loaded).toMatchObject({ source: "base_resume", recordVersion: null, baseVersionId: base.version.id });
    expect(loaded.record.employers[0].name).toBe("Initech");
  });

  it("does not use a resume that is not the base", async () => {
    await createDocument({ kind: "resume", origin: "uploaded", title: "Other", content: baseContent() }, db);
    expect(await loadSource(db)).toBeNull();
  });

  it("prefers the career record once it has experience", async () => {
    await createDocument({ kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: baseContent() }, db);
    await saveRecordVersion({ record: recordWith(employer("Acme", [role({ facts: [fact("f1", [["w1", "Built the billing service"]])] })])), reason: "edit" }, db);
    const loaded = (await loadSource(db))!;
    expect(loaded).toMatchObject({ source: "record", recordVersion: 1, baseVersionId: null });
    expect(loaded.record.employers[0].name).toBe("Acme");
  });

  it("falls back to the base resume when the record has employers but no facts", async () => {
    await createDocument({ kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: baseContent() }, db);
    await saveRecordVersion({ record: recordWith(employer("Acme", [role()])), reason: "edit" }, db);
    expect((await loadSource(db))!.source).toBe("base_resume");
  });
});

const noContact = (): Profile["contact"] => emptyProfile().contact;
const withContact = (contact: Partial<Profile["contact"]>) => {
  const p = profileWith([{ company: "Initech", bullets: ["Wrote the reporting tools"] }]);
  p.contact = { ...noContact(), ...contact };
  return profileToDoc(p, counter("h"));
};

describe("mergeContact", () => {
  it("takes each field from the first that has it, and the links from the first with any", () => {
    const merged = mergeContact([
      { name: "Sam", email: "", phone: "", location: "", links: [] },
      { name: "Other", email: "sam@example.com", phone: "555 0100", location: "", links: ["github.com/sam"] },
      { name: "", email: "", phone: "", location: "Remote", links: ["linkedin.com/in/x"] },
    ]);
    expect(merged).toEqual({ name: "Sam", email: "sam@example.com", phone: "555 0100", location: "Remote", links: ["github.com/sam"] });
  });
});

describe("loadContact", () => {
  it("fills what the Profile leaves empty from the base resume's header", async () => {
    await createDocument({ kind: "resume", origin: "uploaded", title: "Base", isBase: true, content: withContact({ name: "Sam Example", email: "sam@example.com", location: "Remote" }) }, db);
    const contact = await loadContact({ ...noContact(), phone: "555 0100" }, db);
    expect(contact).toMatchObject({ name: "Sam Example", email: "sam@example.com", phone: "555 0100", location: "Remote" });
  });

  it("reads another resume when there is no base, but never a generated one", async () => {
    await createDocument({ kind: "resume", origin: "generated", title: "Made", content: withContact({ name: "Wrong Name" }) }, db);
    await createDocument({ kind: "resume", origin: "uploaded", title: "Mine", content: withContact({ name: "Sam Example" }) }, db);
    expect((await loadContact(noContact(), db)).name).toBe("Sam Example");
  });

  it("stays empty with no resumes", async () => {
    expect(await loadContact(noContact(), db)).toEqual(noContact());
  });
});
