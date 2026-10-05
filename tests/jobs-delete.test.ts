import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { companies, jobKeywords, jobs } from "@/lib/db/schema";
import {
  deleteCompany,
  findCompanyByName,
  getCompanyDetail,
  listCompanies,
  resolveCompany,
  updateCompany,
} from "@/lib/companies/service";
import { emptyExtraction, type JobDraft, type JobEdit } from "@/lib/jobs/schema";
import { deleteJobs, findDuplicate, restoreDeleted, saveJob, updateJob } from "@/lib/jobs/service";
import { dashboardData, getJobDetail, listJobRows } from "@/lib/jobs/tracker";
import { resetDb, testDb } from "./helpers";

process.env.DATABASE_URL ??= "postgres://unused";
vi.mock("@/lib/llm/client", () => ({ together: () => ({}) }));

const db = testDb();
beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

function draft(n: number, over: Partial<JobDraft> = {}): JobDraft {
  const e = { ...emptyExtraction(), company: "Acme", title: `Engineer ${n}`, location: "Austin, TX", keywords: ["go"] };
  return {
    ...e,
    sourceUrl: `https://example.com/jobs/${n}`,
    fetchMethod: "html",
    ats: null,
    atsJobId: null,
    rawFileId: null,
    rawText: "raw",
    normalized: e,
    ...over,
  };
}

async function save(n: number, over: Partial<JobDraft> = {}) {
  const res = await saveJob(draft(n, over), db);
  if (!res.ok) throw new Error("expected a new job");
  return res;
}

async function editOf(jobId: string): Promise<JobEdit> {
  const d = (await getJobDetail(jobId, db))!;
  return {
    company: d.company,
    title: d.title,
    location: d.location,
    remoteType: d.remoteType as JobEdit["remoteType"],
    employmentType: d.employmentType ?? "",
    salaryMin: d.salaryMin,
    salaryMax: d.salaryMax,
    salaryCurrency: d.salaryCurrency ?? "",
    salaryPeriod: d.salaryPeriod ?? "",
    postedAt: d.postedAt ?? "",
    applicationUrl: d.applyUrl ?? "",
    aboutCompany: d.aboutCompany,
    responsibilities: d.responsibilities,
    requirements: d.requirements,
    technologies: d.technologies,
    keywords: d.keywords,
  };
}

describe("deleting jobs", () => {
  it("hides the job everywhere but keeps the row", async () => {
    const a = await save(1);
    await save(2);
    await deleteJobs([a.jobId], db);

    expect((await listJobRows(db)).map((r) => r.jobId)).not.toContain(a.jobId);
    expect(await getJobDetail(a.jobId, db)).toBeNull();
    expect((await dashboardData(db)).total).toBe(1);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, a.jobId));
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it("lets the same job be added again", async () => {
    const a = await save(1);
    await deleteJobs([a.jobId], db);
    expect(await findDuplicate({ canonicalUrl: "https://example.com/jobs/1" }, db)).toBeNull();

    const again = await save(1);
    expect(again.jobId).not.toBe(a.jobId);
    expect((await saveJob(draft(1), db)).ok).toBe(false); // the new copy is a duplicate as usual
  });

  it("deletes the company with its only job, and a fresh one is made when a job comes back", async () => {
    const a = await save(1);
    const before = (await findCompanyByName("Acme", db))!;
    const res = await deleteJobs([a.jobId], db);

    expect(res.companies).toEqual([{ id: before.id, name: "Acme" }]);
    expect(await findCompanyByName("Acme", db)).toBeNull();
    expect(await listCompanies(db)).toEqual([]);
    expect(await getCompanyDetail(before.id, db)).toBeNull();

    await save(1);
    const after = (await findCompanyByName("Acme", db))!;
    expect(after.id).not.toBe(before.id);
  });

  it("keeps a company that still has other jobs", async () => {
    const a = await save(1);
    await save(2);
    const res = await deleteJobs([a.jobId], db);
    expect(res.companies).toEqual([]);
    const [c] = await listCompanies(db);
    expect(c).toMatchObject({ name: "Acme", jobCount: 1 });
  });

  it("keeps a company that other companies are part of", async () => {
    const a = await save(1, { company: "Google" });
    const google = (await findCompanyByName("Google", db))!;
    const youtube = await resolveCompany({ name: "YouTube" }, db);
    await updateCompany(youtube.id, { parentId: google.id }, db);

    expect((await deleteJobs([a.jobId], db)).companies).toEqual([]);
    expect(await findCompanyByName("Google", db)).not.toBeNull();
  });

  it("frees the aliases of a deleted company", async () => {
    const a = await save(1, { company: "Google" });
    const google = (await findCompanyByName("Google", db))!;
    await updateCompany(google.id, { aliases: ["YouTube"] }, db);
    await deleteJobs([a.jobId], db);

    const alphabet = await resolveCompany({ name: "Alphabet" }, db);
    await updateCompany(alphabet.id, { aliases: ["YouTube"] }, db);
    expect((await findCompanyByName("YouTube", db))!.id).toBe(alphabet.id);
  });

  it("refuses unknown or already deleted jobs", async () => {
    const a = await save(1);
    await deleteJobs([a.jobId], db);
    await expect(deleteJobs([a.jobId], db)).rejects.toThrow("Job not found");
  });
});

describe("undo", () => {
  it("restores the jobs and the company deleted with them", async () => {
    const a = await save(1);
    const b = await save(2);
    const res = await deleteJobs([a.jobId, b.jobId], db);
    expect(res.companies).toHaveLength(1);

    expect(await restoreDeleted(res, db)).toEqual({ restored: 2, skipped: 0 });
    expect(await listJobRows(db)).toHaveLength(2);
    const [c] = await listCompanies(db);
    expect(c).toMatchObject({ id: res.companies[0].id, jobCount: 2 });
  });

  it("leaves a job that was saved again, and joins a company that was added again", async () => {
    const a = await save(1);
    const b = await save(2);
    const res = await deleteJobs([a.jobId, b.jobId], db);
    const fresh = await save(1);

    expect(await restoreDeleted(res, db)).toEqual({ restored: 1, skipped: 1 });
    const rows = await listJobRows(db);
    expect(rows.map((r) => r.jobId).sort()).toEqual([fresh.jobId, b.jobId].sort());
    const [c] = await listCompanies(db);
    expect(c.jobCount).toBe(2);
    const [restored] = await db.select().from(jobs).where(eq(jobs.id, b.jobId));
    const [old] = await db.select().from(companies).where(eq(companies.id, res.companies[0].id));
    expect(restored.companyId).toBe(c.id);
    expect(old.deletedAt).not.toBeNull();
  });
});

describe("editing jobs", () => {
  it("saves the edited fields and replaces keywords", async () => {
    const a = await save(1);
    const edit = await editOf(a.jobId);
    await updateJob(
      a.jobId,
      { ...edit, title: " Staff Engineer ", salaryMin: 200000.6, keywords: ["rust"], applicationUrl: "https://acme.com/apply" },
      db,
    );

    const d = (await getJobDetail(a.jobId, db))!;
    expect(d).toMatchObject({ title: "Staff Engineer", salaryMin: 200001, applyUrl: "https://acme.com/apply" });
    expect(d.keywords).toEqual(["rust"]);
    const kw = await db.select().from(jobKeywords).where(eq(jobKeywords.jobId, a.jobId));
    expect(kw).toHaveLength(1);
  });

  it("moves the job to another company and removes the old one when it is left empty", async () => {
    const a = await save(1);
    const old = (await findCompanyByName("Acme", db))!;
    const res = await updateJob(a.jobId, { ...(await editOf(a.jobId)), company: "Globex" }, db);

    expect(res.removedCompanies).toEqual([{ id: old.id, name: "Acme" }]);
    const d = (await getJobDetail(a.jobId, db))!;
    expect(d.companyProfile?.name).toBe("Globex");
    expect((await listCompanies(db)).map((c) => c.name)).toEqual(["Globex"]);
  });

  it("keeps the company when only the spelling of its name changes", async () => {
    const a = await save(1);
    const res = await updateJob(a.jobId, { ...(await editOf(a.jobId)), company: "Acme, Inc." }, db);
    expect(res.removedCompanies).toEqual([]);
    expect((await getJobDetail(a.jobId, db))!.company).toBe("Acme, Inc.");
  });

  it("refuses an edit that would duplicate another saved job, but not a deleted one", async () => {
    const a = await save(1);
    const b = await save(2);
    await expect(updateJob(b.jobId, { ...(await editOf(b.jobId)), title: "Engineer 1" }, db)).rejects.toThrow(
      "already saved",
    );

    await deleteJobs([a.jobId], db);
    await updateJob(b.jobId, { ...(await editOf(b.jobId)), title: "Engineer 1" }, db);
    expect((await getJobDetail(b.jobId, db))!.title).toBe("Engineer 1");
  });

  it("requires a company and title, and refuses deleted jobs", async () => {
    const a = await save(1);
    await expect(updateJob(a.jobId, { ...(await editOf(a.jobId)), title: "  " }, db)).rejects.toThrow();
    const edit = await editOf(a.jobId);
    await deleteJobs([a.jobId], db);
    await expect(updateJob(a.jobId, edit, db)).rejects.toThrow("Job not found");
  });
});

describe("deleting companies", () => {
  it("deletes the company with all its jobs, and undo brings them back", async () => {
    await save(1);
    await save(2);
    const acme = (await findCompanyByName("Acme", db))!;
    const res = await deleteCompany(acme.id, db);

    expect(res.jobIds).toHaveLength(2);
    expect(await listJobRows(db)).toEqual([]);
    expect(await listCompanies(db)).toEqual([]);

    await restoreDeleted(res, db);
    expect(await listJobRows(db)).toHaveLength(2);
    expect((await listCompanies(db))[0]).toMatchObject({ id: acme.id, jobCount: 2 });
  });

  it("undo brings back a company that had no jobs", async () => {
    const c = await resolveCompany({ name: "Initech" }, db);
    const res = await deleteCompany(c.id, db);
    expect(await findCompanyByName("Initech", db)).toBeNull();
    await restoreDeleted(res, db);
    expect((await findCompanyByName("Initech", db))!.id).toBe(c.id);
  });

  it("makes the companies that were part of it independent", async () => {
    const google = await resolveCompany({ name: "Google" }, db);
    const youtube = await resolveCompany({ name: "YouTube" }, db);
    await updateCompany(youtube.id, { parentId: google.id }, db);
    await deleteCompany(google.id, db);
    expect((await getCompanyDetail(youtube.id, db))!.parentId).toBeNull();
  });
});
