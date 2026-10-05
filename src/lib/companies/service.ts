import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import {
  companies,
  companyAliases,
  jobs,
  applications,
  type CompanyProvenance,
  type CompanyRow,
} from "@/lib/db/schema";
import { normalizeForDedup } from "@/lib/jobs/dedup";
import {
  MAX_FIELD_CHARS,
  type CompanyDetail,
  type CompanyField,
  type CompanyProfile,
  type CompanyProfileBase,
  type CompanyResearch,
  type CompanySummary,
} from "./types";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Deleted rows are kept (soft delete) but are invisible everywhere. */
const liveCompany = isNull(companies.deletedAt);
const liveJob = isNull(jobs.deletedAt);

/** Names are compared after dropping case, punctuation and suffixes like Inc/LLC/GmbH. */
export function normalizeCompanyName(name: string): string {
  return normalizeForDedup(name) || name.toLowerCase().trim();
}

export function toProfileBase(c: CompanyRow): CompanyProfileBase {
  return {
    id: c.id,
    name: c.name,
    website: c.website,
    about: c.about,
    principles: c.principles,
    culture: c.culture,
    notes: c.notes,
    provenance: c.provenance,
    sources: c.sources,
    researchLog: c.researchLog,
    researchedAt: iso(c.researchedAt),
  };
}

/** The profile plus the group it belongs to (one level), for display and export. */
export function toProfile(c: CompanyRow, parent: CompanyRow | null = null): CompanyProfile {
  return { ...toProfileBase(c), parent: parent ? toProfileBase(parent) : null };
}

/** Loads the company's direct parent, if any. */
export async function loadParent(c: CompanyRow, db: DbOrTx = defaultDb()): Promise<CompanyRow | null> {
  if (!c.parentId) return null;
  const [p] = await db.select().from(companies).where(and(eq(companies.id, c.parentId), liveCompany));
  return p ?? null;
}

/** The directory entry for this name or any of its aliases. */
export async function findCompanyByName(name: string, db: DbOrTx = defaultDb()): Promise<CompanyRow | null> {
  const key = normalizeCompanyName(name);
  if (!key) return null;
  const [direct] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.normalizedName, key), liveCompany))
    .limit(1);
  if (direct) return direct;
  const [viaAlias] = await db
    .select({ company: companies })
    .from(companyAliases)
    .innerJoin(companies, eq(companies.id, companyAliases.companyId))
    .where(and(eq(companyAliases.normalizedAlias, key), liveCompany))
    .limit(1);
  return viaAlias?.company ?? null;
}

/**
 * Finds or creates the directory entry for a company name. When the entry has no "what they do" text yet,
 * the posting's own description of the employer seeds it (marked as coming from a posting).
 */
export async function resolveCompany(
  input: { name: string; aboutFromPosting?: string },
  db: DbOrTx = defaultDb(),
): Promise<CompanyRow> {
  const name = input.name.trim();
  let company = await findCompanyByName(name, db);
  if (!company) {
    const [created] = await db
      .insert(companies)
      .values({ name, normalizedName: normalizeCompanyName(name) })
      .onConflictDoNothing({ target: companies.normalizedName, where: sql`deleted_at is null` })
      .returning();
    company = created ?? (await findCompanyByName(name, db))!; // lost a race with another save
  }

  const about = input.aboutFromPosting?.trim();
  if (about && !company.about) {
    const [seeded] = await db
      .update(companies)
      .set({ about, provenance: { ...company.provenance, about: "posting" }, updatedAt: new Date() })
      .where(and(eq(companies.id, company.id), eq(companies.about, "")))
      .returning();
    if (seeded) company = seeded;
  }
  return company;
}

/** Posting URLs of this company's saved jobs; used to find the company's own website. */
export async function companyJobUrls(id: string, db: Db = defaultDb()): Promise<string[]> {
  // A group's own site often hosts its brands' job postings (YouTube roles live on Google's careers site).
  const children = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.parentId, id), liveCompany));
  const rows = await db
    .select({ url: jobs.canonicalUrl })
    .from(jobs)
    .where(
      and(
        liveJob,
        or(eq(jobs.companyId, id), children.length ? inArray(jobs.companyId, children.map((c) => c.id)) : undefined),
      ),
    )
    .orderBy(sql`${jobs.createdAt} desc`)
    .limit(5);
  return rows.map((r) => r.url).filter((u): u is string => Boolean(u));
}

export async function createCompany(name: string, db: Db = defaultDb()): Promise<CompanyRow> {
  if (!name.trim()) throw new Error("Enter a company name");
  return resolveCompany({ name }, db);
}

/** Links jobs saved before the directory existed. Cheap no-op when there is nothing to do. */
export async function backfillCompanies(db: Db = defaultDb()): Promise<void> {
  const orphans = await db
    .select({ id: jobs.id, company: jobs.company, aboutCompany: jobs.aboutCompany })
    .from(jobs)
    .where(and(isNull(jobs.companyId), liveJob));
  for (const j of orphans) {
    const c = await resolveCompany({ name: j.company, aboutFromPosting: j.aboutCompany }, db);
    await db.update(jobs).set({ companyId: c.id }).where(eq(jobs.id, j.id));
  }
}

export async function listCompanies(db: Db = defaultDb()): Promise<CompanySummary[]> {
  await backfillCompanies(db);
  const rows = await db
    .select({
      company: companies,
      // Literal names: Drizzle drops table prefixes in single-table selects, which would make this subquery ambiguous.
      jobCount: sql<number>`(select count(*)::int from "jobs" j where j."company_id" = "companies"."id" and j."deleted_at" is null)`,
    })
    .from(companies)
    .where(liveCompany)
    .orderBy(asc(companies.normalizedName));
  const aliases = await db.select().from(companyAliases);
  const byCompany = new Map<string, string[]>();
  for (const a of aliases) byCompany.set(a.companyId, [...(byCompany.get(a.companyId) ?? []), a.alias]);
  const names = new Map(rows.map(({ company: c }) => [c.id, c.name]));
  return rows.map(({ company: c, jobCount }) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    jobCount,
    aliases: byCompany.get(c.id) ?? [],
    parentName: c.parentId ? (names.get(c.parentId) ?? null) : null,
    hasAbout: c.about.trim() !== "",
    hasPrinciples: c.principles.trim() !== "",
    hasCulture: c.culture.trim() !== "",
    researchedAt: iso(c.researchedAt),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function getCompanyDetail(id: string, db: Db = defaultDb()): Promise<CompanyDetail | null> {
  const [c] = await db.select().from(companies).where(and(eq(companies.id, id), liveCompany));
  if (!c) return null;
  const [parent, children, aliases, jobRows] = await Promise.all([
    loadParent(c, db),
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(and(eq(companies.parentId, id), liveCompany))
      .orderBy(asc(companies.name)),
    db.select().from(companyAliases).where(eq(companyAliases.companyId, id)).orderBy(asc(companyAliases.alias)),
    db
      .select({
        jobId: jobs.id,
        title: jobs.title,
        status: applications.status,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .innerJoin(applications, eq(applications.jobId, jobs.id))
      .where(and(eq(jobs.companyId, id), liveJob))
      .orderBy(sql`${jobs.createdAt} desc`),
  ]);
  return {
    ...toProfile(c, parent),
    parentId: c.parentId,
    children,
    aliases: aliases.map((a) => a.alias),
    jobs: jobRows.map((j) => ({ ...j, createdAt: j.createdAt.toISOString() })),
  };
}

export type CompanyEdit = Partial<{
  name: string;
  website: string;
  about: string;
  principles: string;
  culture: string;
  notes: string;
  aliases: string[];
  /** The group this company belongs to; null clears it. */
  parentId: string | null;
}>;

/**
 * Saves the user's edits. A changed about/principles/culture field becomes "user"-owned, which locks it
 * against automated overwrite; clearing a field hands it back to automation.
 */
export async function updateCompany(id: string, edit: CompanyEdit, db: Db = defaultDb()): Promise<void> {
  for (const k of ["about", "principles", "culture", "notes"] as const) {
    if (edit[k] !== undefined && edit[k]!.length > MAX_FIELD_CHARS) {
      throw new Error(`${k} can be at most ${MAX_FIELD_CHARS.toLocaleString("en-US")} characters`);
    }
  }
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(companies).where(and(eq(companies.id, id), liveCompany)).for("update");
    if (!c) throw new Error("Company not found");

    const patch: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
    const provenance: CompanyProvenance = { ...c.provenance };

    if (edit.name !== undefined && edit.name.trim() !== c.name) {
      const name = edit.name.trim();
      if (!name) throw new Error("Enter a company name");
      const clash = await findCompanyByName(name, tx);
      if (clash && clash.id !== id) throw new Error(`"${clash.name}" already exists. Merge the two instead.`);
      patch.name = name;
      patch.normalizedName = normalizeCompanyName(name);
    }
    if (edit.parentId !== undefined) {
      if (edit.parentId === id) throw new Error("A company cannot be part of itself");
      if (edit.parentId) {
        // Walk up from the proposed parent: reaching this company would make a loop.
        let cursor: string | null = edit.parentId;
        for (let depth = 0; cursor && depth < 10; depth++) {
          if (cursor === id) throw new Error("That would make the two companies part of each other");
          const [row] = await tx
            .select({ parentId: companies.parentId })
            .from(companies)
            .where(and(eq(companies.id, cursor), liveCompany));
          if (!row && depth === 0) throw new Error("Parent company not found");
          cursor = row?.parentId ?? null;
        }
      }
      patch.parentId = edit.parentId;
    }
    if (edit.website !== undefined) patch.website = edit.website.trim();
    if (edit.notes !== undefined) patch.notes = edit.notes;

    for (const f of ["about", "principles", "culture"] as CompanyField[]) {
      const next = edit[f];
      if (next === undefined || next === c[f]) continue;
      patch[f] = next;
      if (next.trim()) provenance[f] = "user";
      else delete provenance[f];
    }
    patch.provenance = provenance;
    await tx.update(companies).set(patch).where(eq(companies.id, id));

    if (edit.aliases) {
      const wanted = new Map<string, string>();
      for (const a of edit.aliases) {
        const alias = a.trim();
        const key = normalizeCompanyName(alias);
        if (alias && key !== (patch.normalizedName ?? c.normalizedName)) wanted.set(key, alias);
      }
      for (const [key] of wanted) {
        const owner = await findCompanyByName(key, tx);
        if (owner && owner.id !== id) throw new Error(`"${owner.name}" already uses the name "${wanted.get(key)}"`);
      }
      await tx.delete(companyAliases).where(eq(companyAliases.companyId, id));
      await releaseDeletedAliases([...wanted.keys()], tx);
      if (wanted.size) {
        await tx
          .insert(companyAliases)
          .values([...wanted].map(([normalizedAlias, alias]) => ({ companyId: id, alias, normalizedAlias })));
      }
    }
  });
}

/** Folds `sourceId` into `targetId`: jobs and aliases move, the old name becomes an alias, empty fields are filled. */
export async function mergeCompanies(sourceId: string, targetId: string, db: Db = defaultDb()): Promise<void> {
  if (sourceId === targetId) throw new Error("Pick a different company to merge into");
  await db.transaction(async (tx) => {
    const [src] = await tx.select().from(companies).where(and(eq(companies.id, sourceId), liveCompany)).for("update");
    const [dst] = await tx.select().from(companies).where(and(eq(companies.id, targetId), liveCompany)).for("update");
    if (!src || !dst) throw new Error("Company not found");

    await tx.update(jobs).set({ companyId: targetId }).where(eq(jobs.companyId, sourceId));
    await tx.update(companyAliases).set({ companyId: targetId }).where(eq(companyAliases.companyId, sourceId));
    // Brands that were part of the source are now part of the target (unless that would make it its own parent).
    await tx.update(companies).set({ parentId: targetId }).where(and(eq(companies.parentId, sourceId), sql`${companies.id} <> ${targetId}`));
    if (dst.parentId === sourceId) await tx.update(companies).set({ parentId: null }).where(eq(companies.id, targetId));

    const patch: Partial<typeof companies.$inferInsert> = { updatedAt: new Date() };
    const provenance: CompanyProvenance = { ...dst.provenance };
    for (const f of ["about", "principles", "culture"] as CompanyField[]) {
      if (!dst[f].trim() && src[f].trim()) {
        patch[f] = src[f];
        if (src.provenance[f]) provenance[f] = src.provenance[f];
      }
    }
    patch.provenance = provenance;
    if (!dst.parentId && src.parentId && src.parentId !== targetId) patch.parentId = src.parentId;
    if (!dst.website && src.website) patch.website = src.website;
    if (src.notes.trim()) patch.notes = dst.notes.trim() ? `${dst.notes}\n\n${src.notes}` : src.notes;
    patch.sources = [...dst.sources, ...src.sources.filter((s) => !dst.sources.some((d) => d.url === s.url))];
    await tx.update(companies).set(patch).where(eq(companies.id, targetId));

    await tx.delete(companies).where(eq(companies.id, sourceId));
    if (src.normalizedName !== dst.normalizedName) {
      await releaseDeletedAliases([src.normalizedName], tx);
      await tx
        .insert(companyAliases)
        .values({ companyId: targetId, alias: src.name, normalizedAlias: src.normalizedName })
        .onConflictDoNothing();
    }
  });
}

/** Applies web research. Fields the user has edited are never touched; empty results never blank existing text. */
export async function applyResearch(id: string, research: CompanyResearch, db: DbOrTx = defaultDb()): Promise<CompanyField[]> {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(companies).where(eq(companies.id, id)).for("update");
    if (!c) throw new Error("Company not found");
    const patch: Partial<typeof companies.$inferInsert> = { researchedAt: new Date(), updatedAt: new Date() };
    const provenance: CompanyProvenance = { ...c.provenance };
    const applied: CompanyField[] = [];
    for (const f of ["about", "principles", "culture"] as CompanyField[]) {
      const text = research[f].trim();
      if (!text || provenance[f] === "user") continue;
      patch[f] = text;
      provenance[f] = "web";
      applied.push(f);
    }
    patch.provenance = provenance;
    if (!c.website && research.website) patch.website = research.website;
    if (research.sources.length) patch.sources = research.sources;
    if (research.log) patch.researchLog = research.log;
    await tx.update(companies).set(patch).where(eq(companies.id, id));
    return applied;
  });
}

/** True when automated research has nothing left to add (every field is filled or user-owned). */
export function needsResearch(c: Pick<CompanyRow, "about" | "principles" | "culture" | "researchedAt">): boolean {
  return !c.researchedAt && !(c.about.trim() && c.principles.trim() && c.culture.trim());
}


/** Aliases of deleted companies would otherwise keep their names reserved forever. */
async function releaseDeletedAliases(keys: string[], db: DbOrTx): Promise<void> {
  if (!keys.length) return;
  await db
    .delete(companyAliases)
    .where(
      and(
        inArray(companyAliases.normalizedAlias, keys),
        inArray(
          companyAliases.companyId,
          db.select({ id: companies.id }).from(companies).where(sql`${companies.deletedAt} is not null`),
        ),
      ),
    );
}

export type RemovedCompany = { id: string; name: string };

/**
 * Soft-deletes the given companies that no longer have any jobs. A company that other companies are
 * part of (a group like Google) is kept, since it is still in use.
 */
export async function removeCompaniesWithoutJobs(ids: string[], db: DbOrTx = defaultDb()): Promise<RemovedCompany[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return db
    .update(companies)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(companies.id, unique),
        liveCompany,
        // Literal names: Drizzle drops table prefixes in single-table statements, which would make these ambiguous.
        sql`not exists (select 1 from "jobs" j where j."company_id" = "companies"."id" and j."deleted_at" is null)`,
        sql`not exists (select 1 from "companies" c where c."parent_id" = "companies"."id" and c."deleted_at" is null)`,
      ),
    )
    .returning({ id: companies.id, name: companies.name });
}

/**
 * Soft-deletes a company together with all of its jobs. Companies that were part of it become
 * independent. Returns what was deleted so it can be restored.
 */
export async function deleteCompany(
  id: string,
  db: Db = defaultDb(),
): Promise<{ jobIds: string[]; companies: RemovedCompany[] }> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [c] = await tx
      .update(companies)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(companies.id, id), liveCompany))
      .returning({ id: companies.id, name: companies.name });
    if (!c) throw new Error("Company not found");
    const deleted = await tx
      .update(jobs)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(jobs.companyId, id), liveJob))
      .returning({ id: jobs.id });
    await tx.update(companies).set({ parentId: null, updatedAt: now }).where(eq(companies.parentId, id));
    return { jobIds: deleted.map((j) => j.id), companies: [c] };
  });
}
