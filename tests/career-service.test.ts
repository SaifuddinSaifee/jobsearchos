import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/openai", () => ({ chatClient: () => ({}) }));

import { resetDb, testDb } from "./helpers";
import {
  currentRecord,
  editRecord,
  getLatestRecord,
  listSourceInfo,
  listRecordVersions,
  RecordConflict,
  restoreRecordVersion,
  saveRecordVersion,
} from "@/lib/career/service";
import { CareerRecordSchema, emptyRecord, mergeProvenance, type CareerRecord } from "@/lib/career/schema";
import { careerProposals, careerSources } from "@/lib/db/schema";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { createDocument, softDelete } from "@/lib/documents/service";

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

const SOURCE = "11111111-1111-4111-8111-111111111111";

function recordWith(name: string): CareerRecord {
  const r = emptyRecord();
  r.employers.push({
    id: "e1",
    name,
    companyId: null,
    names: [name],
    roles: [],
    sources: [{ sourceId: SOURCE, blockId: null }],
    provenance: mergeProvenance(),
  });
  return r;
}

describe("career record versions", () => {
  it("starts empty", async () => {
    expect(await getLatestRecord(db)).toBeNull();
    const cur = await currentRecord(db);
    expect(cur.version).toBe(0);
    expect(cur.record).toEqual(emptyRecord());
  });

  it("numbers versions one after another", async () => {
    const a = await saveRecordVersion({ record: recordWith("Acme"), reason: "merge", note: "first" }, db);
    const b = await saveRecordVersion({ record: recordWith("Beta"), reason: "edit" }, db);
    expect([a.version, b.version]).toEqual([1, 2]);
    expect((await getLatestRecord(db))?.record.employers[0].name).toBe("Beta");
    const list = await listRecordVersions(db);
    expect(list.map((v) => v.version)).toEqual([2, 1]);
    expect(list[1].changeNote).toBe("first");
  });

  it("rejects UPDATE and DELETE with the database trigger", async () => {
    await saveRecordVersion({ record: recordWith("Acme"), reason: "merge" }, db);
    for (const statement of [
      sql`UPDATE career_record_versions SET change_note = 'x'`,
      sql`DELETE FROM career_record_versions`,
    ]) {
      const err = await db.execute(statement).then(
        () => null,
        (e: Error & { cause?: Error }) => e,
      );
      expect(String(err?.cause?.message ?? err?.message)).toMatch(/immutable/);
    }
  });

  it("raises RecordConflict when the expected version is stale", async () => {
    await saveRecordVersion({ record: recordWith("Acme"), reason: "merge", expectedVersion: 0 }, db);
    await expect(
      saveRecordVersion({ record: recordWith("Beta"), reason: "edit", expectedVersion: 0 }, db),
    ).rejects.toBeInstanceOf(RecordConflict);
    const ok = await saveRecordVersion({ record: recordWith("Beta"), reason: "edit", expectedVersion: 1 }, db);
    expect(ok.version).toBe(2);
  });

  it("keeps numbering unique when two saves race", async () => {
    const saves = await Promise.all(
      [1, 2, 3, 4].map((i) => saveRecordVersion({ record: recordWith(`Co ${i}`), reason: "edit" }, db)),
    );
    expect(saves.map((s) => s.version).sort()).toEqual([1, 2, 3, 4]);
  });

  it("rejects a malformed record", async () => {
    const bad = { ...emptyRecord(), employers: [{ id: "", name: "" }] };
    expect(CareerRecordSchema.safeParse(bad).success).toBe(false);
    await expect(saveRecordVersion({ record: bad, reason: "edit" }, db)).rejects.toThrow();
    expect(await getLatestRecord(db)).toBeNull();
  });

  it("restores an old version as a new one and marks later merges undone", async () => {
    const v1 = await saveRecordVersion({ record: recordWith("Acme"), reason: "merge" }, db);
    const [source] = await db
      .insert(careerSources)
      .values({ kind: "linkedin", text: "x", contentSha256: "s", label: "LinkedIn" })
      .returning();
    const v2 = await saveRecordVersion({ record: recordWith("Beta"), reason: "merge" }, db);
    const [prop] = await db
      .insert(careerProposals)
      .values({ sourceId: source.id, status: "applied", appliedVersionId: v2.id })
      .returning();

    const restored = await restoreRecordVersion(v1.id, db);
    expect(restored.version).toBe(3);
    expect(restored.reason).toBe("restore");
    expect(restored.restoredFromVersionId).toBe(v1.id);
    expect(restored.record.employers[0].name).toBe("Acme");
    expect(restored.changeNote).toBe("Restored from version 1");

    const [after] = await db.select().from(careerProposals);
    expect(after.id).toBe(prop.id);
    expect(after.status).toBe("undone");
  });
});

describe("career tables", () => {
  it("allows only one running or ready proposal at a time", async () => {
    const [a, b] = await db
      .insert(careerSources)
      .values([
        { kind: "linkedin", text: "a", contentSha256: "a", label: "A" },
        { kind: "linkedin", text: "b", contentSha256: "b", label: "B" },
      ])
      .returning();
    await db.insert(careerProposals).values({ sourceId: a.id, status: "ready" });
    await db.insert(careerProposals).values({ sourceId: b.id, status: "queued" });
    await expect(
      db.update(careerProposals).set({ status: "running" }).where(sql`${careerProposals.sourceId} = ${b.id}`),
    ).rejects.toThrow();
  });

  it("ties a source's key column to its kind", async () => {
    await expect(
      db.insert(careerSources).values({ kind: "profile", text: "x", contentSha256: "s", label: "P" }),
    ).rejects.toThrow();
    await expect(
      db.insert(careerSources).values({ kind: "linkedin", contentSha256: "s", label: "L" }),
    ).rejects.toThrow();
  });
});

describe("editRecord", () => {
  it("saves a hand edit as a new version with a note", async () => {
    const v1 = await saveRecordVersion({ record: recordWith("Acme"), reason: "merge" }, db);
    const v2 = await editRecord({ op: "editEmployer", employerId: "e1", name: "Acme Corp" }, v1.version, db);
    expect(v2).toMatchObject({ version: 2, reason: "edit", changeNote: "Renamed Acme Corp" });
    expect(v2.record.employers[0].name).toBe("Acme Corp");
    expect((await currentRecord(db)).version).toBe(2);
  });

  it("refuses an edit made on an old version", async () => {
    await saveRecordVersion({ record: recordWith("Acme"), reason: "merge" }, db);
    await saveRecordVersion({ record: recordWith("Beta"), reason: "edit" }, db);
    await expect(editRecord({ op: "deleteEmployer", employerId: "e1" }, 1, db)).rejects.toBeInstanceOf(RecordConflict);
    expect((await currentRecord(db)).version).toBe(2);
  });
});

describe("listSourceInfo", () => {
  it("links a document source to the exact version and marks deleted documents", async () => {
    const { document, version } = await createDocument(
      { kind: "resume", origin: "pasted", title: "My resume", content: textToDoc("Hello there, a resume") },
      db,
    );
    await db.insert(careerSources).values([
      { kind: "resume", documentId: document.id, documentVersionId: version.id, contentSha256: "a", label: "My resume" },
      { kind: "linkedin", text: "x", contentSha256: "b", label: "LinkedIn" },
    ]);
    let info = Object.values(await listSourceInfo(db));
    expect(info.find((i) => i.kind === "resume")).toMatchObject({ label: "My resume", deleted: false, href: `/library/${document.id}?version=${version.id}` });
    expect(info.find((i) => i.kind === "linkedin")).toMatchObject({ href: null, deleted: false });

    await softDelete(document.id, db);
    info = Object.values(await listSourceInfo(db));
    expect(info.find((i) => i.kind === "resume")).toMatchObject({ deleted: true, href: null });
  });
});
