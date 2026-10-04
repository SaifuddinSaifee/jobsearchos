import { desc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  applications,
  companies,
  jobKeywords,
  jobs,
  jobSnapshots,
  statusEvents,
} from "@/lib/db/schema";
import { toProfile } from "@/lib/companies/service";
import { dateToStored } from "./format";
import { safeHref } from "./links";
import {
  STALE_APPLIED_DAYS,
  STALE_PREPARING_DAYS,
  statusInfo,
  type ApplicationStatus,
  type StatusGroup,
} from "./status";

import {
  MAX_BULK,
  MAX_NOTES,
  type JobDetail,
  type JobRow,
  type PreviousState,
  type TimelineEvent,
} from "./types";

export { MAX_BULK, MAX_NOTES };
export type { JobDetail, JobRow, PreviousState, TimelineEvent };


const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const lastChangeSql = sql<string>`coalesce((select to_char(max(${statusEvents.at}) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from ${statusEvents} where ${statusEvents.applicationId} = ${applications.id}), to_char(${applications.createdAt} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;

const latestMethodSql = sql<string | null>`(select ${jobSnapshots.fetchMethod} from ${jobSnapshots} where ${jobSnapshots.jobId} = ${jobs.id} order by ${jobSnapshots.fetchedAt} desc limit 1)`;

const rowSelection = {
  jobId: jobs.id,
  applicationId: applications.id,
  company: jobs.company,
  title: jobs.title,
  location: jobs.location,
  remoteType: jobs.remoteType,
  salaryMin: jobs.salaryMin,
  salaryMax: jobs.salaryMax,
  salaryCurrency: jobs.salaryCurrency,
  salaryPeriod: jobs.salaryPeriod,
  status: applications.status,
  appliedAt: applications.appliedAt,
  postedAt: jobs.postedAt,
  createdAt: jobs.createdAt,
  lastChangeAt: lastChangeSql,
  employmentType: jobs.employmentType,
  ats: jobs.ats,
  fetchMethod: latestMethodSql,
  canonicalUrl: jobs.canonicalUrl,
  jobApplyUrl: jobs.applicationUrl,
  appApplyUrl: applications.applicationUrl,
  technologies: jobs.technologies,
  hasNotes: sql<boolean>`coalesce(length(trim(${applications.notes})) > 0, false)`,
};

function toRow(r: Awaited<ReturnType<typeof selectRows>>[number]): JobRow {
  return {
    jobId: r.jobId,
    applicationId: r.applicationId,
    company: r.company,
    title: r.title,
    location: r.location,
    remoteType: r.remoteType,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    salaryCurrency: r.salaryCurrency,
    salaryPeriod: r.salaryPeriod,
    status: r.status,
    appliedAt: iso(r.appliedAt),
    postedAt: r.postedAt,
    createdAt: r.createdAt.toISOString(),
    lastChangeAt: r.lastChangeAt,
    employmentType: r.employmentType,
    source: r.ats ?? r.fetchMethod ?? "html",
    postingUrl: safeHref(r.canonicalUrl),
    applyUrl: safeHref(r.appApplyUrl) ?? safeHref(r.jobApplyUrl),
    technologies: r.technologies,
    hasNotes: r.hasNotes,
  };
}

function selectRows(db: Db) {
  return db
    .select(rowSelection)
    .from(jobs)
    .innerJoin(applications, eq(applications.jobId, jobs.id));
}

export async function listJobRows(db: Db = defaultDb()): Promise<JobRow[]> {
  const rows = await selectRows(db).orderBy(desc(jobs.createdAt));
  return rows.map(toRow);
}

export async function getJobDetail(jobId: string, db: Db = defaultDb()): Promise<JobDetail | null> {
  const [r] = await selectRows(db).where(eq(jobs.id, jobId)).limit(1);
  if (!r) return null;

  const [extra] = await db
    .select({
      notes: applications.notes,
      responsibilities: jobs.responsibilities,
      requirements: jobs.requirements,
      aboutCompany: jobs.aboutCompany,
      companyId: jobs.companyId,
    })
    .from(jobs)
    .innerJoin(applications, eq(applications.jobId, jobs.id))
    .where(eq(jobs.id, jobId));

  const [keywords, events, [snap], [company]] = await Promise.all([
    db.select({ keyword: jobKeywords.keyword }).from(jobKeywords).where(eq(jobKeywords.jobId, jobId)),
    db
      .select()
      .from(statusEvents)
      .where(eq(statusEvents.applicationId, r.applicationId))
      .orderBy(desc(statusEvents.at), desc(statusEvents.id)),
    db
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, jobId))
      .orderBy(desc(jobSnapshots.fetchedAt))
      .limit(1),
    extra.companyId
      ? db.select().from(companies).where(eq(companies.id, extra.companyId))
      : Promise.resolve([] as (typeof companies.$inferSelect)[]),
  ]);

  return {
    ...toRow(r),
    notes: extra.notes ?? "",
    aboutCompany: extra.aboutCompany,
    companyProfile: company ? toProfile(company) : null,
    responsibilities: extra.responsibilities,
    requirements: extra.requirements,
    keywords: keywords.map((k) => k.keyword),
    timeline: events.map((e) => ({
      id: e.id,
      from: e.fromStatus,
      to: e.toStatus,
      at: e.at.toISOString(),
      note: e.note,
    })),
    snapshot: snap
      ? {
          sourceUrl: snap.sourceUrl,
          fetchMethod: snap.fetchMethod,
          fetchedAt: snap.fetchedAt.toISOString(),
          rawText: snap.rawText,
        }
      : null,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function lockApplication(tx: Tx, applicationId: string) {
  const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId)).for("update");
  if (!app) throw new Error("Application not found");
  return app;
}

async function applyStatus(
  tx: Tx,
  applicationId: string,
  to: ApplicationStatus,
  opts: { appliedDate?: string; note?: string; restoreAppliedAt?: Date | null },
): Promise<PreviousState | null> {
  const app = await lockApplication(tx, applicationId);
  if (app.status === to) return null;

  const patch: Partial<typeof applications.$inferInsert> = { status: to, updatedAt: new Date() };
  if (opts.restoreAppliedAt !== undefined) {
    patch.appliedAt = opts.restoreAppliedAt;
  } else if (to === "applied" && !app.appliedAt) {
    patch.appliedAt = opts.appliedDate ? dateToStored(opts.appliedDate) : new Date();
  }
  await tx.update(applications).set(patch).where(eq(applications.id, applicationId));
  await tx.insert(statusEvents).values({
    applicationId,
    fromStatus: app.status,
    toStatus: to,
    note: opts.note ?? null,
  });
  await tx.update(jobs).set({ updatedAt: new Date() }).where(eq(jobs.id, app.jobId));
  return { applicationId, status: app.status, appliedAt: iso(app.appliedAt), expected: to };
}

export type ChangeResult = { previous: PreviousState[] };

export async function changeStatus(
  applicationId: string,
  to: ApplicationStatus,
  opts: { appliedDate?: string; note?: string } = {},
  db: Db = defaultDb(),
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    const prev = await applyStatus(tx, applicationId, to, opts);
    return { previous: prev ? [prev] : [] };
  });
}

export async function changeStatusBulk(
  applicationIds: string[],
  to: ApplicationStatus,
  opts: { appliedDate?: string } = {},
  db: Db = defaultDb(),
): Promise<ChangeResult> {
  const ids = [...new Set(applicationIds)];
  if (ids.length === 0) return { previous: [] };
  if (ids.length > MAX_BULK) throw new Error(`Select at most ${MAX_BULK} jobs at once`);
  return db.transaction(async (tx) => {
    const previous: PreviousState[] = [];
    for (const id of ids) {
      const prev = await applyStatus(tx, id, to, opts); // throws on an unknown id, rolling back everything
      if (prev) previous.push(prev);
    }
    return { previous };
  });
}

/** Undo: puts each application back, unless its status was changed again since. */
export async function revertStatus(
  previous: PreviousState[],
  db: Db = defaultDb(),
): Promise<{ reverted: number; skipped: string[] }> {
  return db.transaction(async (tx) => {
    let reverted = 0;
    const skipped: string[] = [];
    for (const p of previous) {
      const app = await lockApplication(tx, p.applicationId);
      if (app.status !== p.expected) {
        skipped.push(p.applicationId);
        continue;
      }
      await applyStatus(tx, p.applicationId, p.status, {
        note: "Undo",
        restoreAppliedAt: p.appliedAt ? new Date(p.appliedAt) : null,
      });
      reverted++;
    }
    return { reverted, skipped };
  });
}

export async function setAppliedAt(applicationId: string, date: string, db: Db = defaultDb()) {
  const res = await db
    .update(applications)
    .set({ appliedAt: dateToStored(date), updatedAt: new Date() })
    .where(eq(applications.id, applicationId))
    .returning({ id: applications.id });
  if (!res.length) throw new Error("Application not found");
}

export async function saveNotes(applicationId: string, notes: string, db: Db = defaultDb()) {
  if (notes.length > MAX_NOTES) throw new Error(`Notes can be at most ${MAX_NOTES} characters`);
  const res = await db
    .update(applications)
    .set({ notes, updatedAt: new Date() })
    .where(eq(applications.id, applicationId))
    .returning({ id: applications.id });
  if (!res.length) throw new Error("Application not found");
}

export type ExportRow = JobRow & { notes: string };

/** Rows for CSV, in the order of `applicationIds` (or newest first when null). */
export async function exportRows(applicationIds: string[] | null, db: Db = defaultDb()): Promise<ExportRow[]> {
  if (applicationIds && applicationIds.length === 0) return [];
  const base = selectRows(db);
  const rows = applicationIds
    ? await base.where(inArray(applications.id, applicationIds))
    : await base.orderBy(desc(jobs.createdAt));
  const notes = await db
    .select({ id: applications.id, notes: applications.notes })
    .from(applications)
    .where(
      applicationIds ? inArray(applications.id, applicationIds) : sql`true`,
    );
  const notesById = new Map(notes.map((n) => [n.id, n.notes ?? ""]));
  const out = rows.map((r) => ({ ...toRow(r), notes: notesById.get(r.applicationId) ?? "" }));
  if (applicationIds) {
    const order = new Map(applicationIds.map((id, i) => [id, i]));
    out.sort((a, b) => (order.get(a.applicationId) ?? 0) - (order.get(b.applicationId) ?? 0));
  }
  return out;
}

export type AttentionItem = {
  jobId: string;
  title: string;
  company: string;
  status: ApplicationStatus;
  daysSince: number;
};

export type DashboardData = {
  total: number;
  funnel: Record<StatusGroup, number>;
  needsAttention: AttentionItem[];
  recent: {
    id: string;
    jobId: string;
    title: string;
    company: string;
    from: ApplicationStatus | null;
    to: ApplicationStatus;
    at: string;
    note: string | null;
  }[];
};

export async function dashboardData(db: Db = defaultDb(), now = new Date()): Promise<DashboardData> {
  const rows = await listJobRows(db);

  const funnel: Record<StatusGroup, number> = { active: 0, applied: 0, interviews: 0, offers: 0, closed: 0 };
  const needsAttention: AttentionItem[] = [];
  for (const r of rows) {
    funnel[statusInfo(r.status).group]++;
    const days = Math.floor((now.getTime() - new Date(r.lastChangeAt).getTime()) / 86_400_000);
    const limit =
      r.status === "applied" ? STALE_APPLIED_DAYS : r.status === "preparing" ? STALE_PREPARING_DAYS : null;
    if (limit !== null && days >= limit) {
      needsAttention.push({ jobId: r.jobId, title: r.title, company: r.company, status: r.status, daysSince: days });
    }
  }
  needsAttention.sort((a, b) => b.daysSince - a.daysSince);

  const events = await db
    .select({
      id: statusEvents.id,
      jobId: jobs.id,
      title: jobs.title,
      company: jobs.company,
      from: statusEvents.fromStatus,
      to: statusEvents.toStatus,
      at: statusEvents.at,
      note: statusEvents.note,
    })
    .from(statusEvents)
    .innerJoin(applications, eq(applications.id, statusEvents.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .orderBy(desc(statusEvents.at), desc(statusEvents.id))
    .limit(10);

  return {
    total: rows.length,
    funnel,
    needsAttention,
    recent: events.map((e) => ({ ...e, at: e.at.toISOString() })),
  };
}

