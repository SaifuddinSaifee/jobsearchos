import { asc, eq, inArray, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { quickLinks, type QuickLinkRow } from "@/lib/db/schema";
import type { QuickLink, QuickLinkInput } from "./types";

function toQuickLink(r: QuickLinkRow): QuickLink {
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    note: r.note,
    group: r.group,
    lastOpenedAt: r.lastOpenedAt ? r.lastOpenedAt.toISOString() : null,
  };
}

export async function listQuickLinks(db: Db = defaultDb()): Promise<QuickLink[]> {
  const rows = await db.select().from(quickLinks).orderBy(asc(quickLinks.position), asc(quickLinks.createdAt));
  return rows.map(toQuickLink);
}

/** New links go to the end of the list. */
export async function createQuickLink(input: QuickLinkInput, db: Db = defaultDb()): Promise<QuickLink> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${quickLinks.position}), -1) + 1` })
    .from(quickLinks);
  const [row] = await db
    .insert(quickLinks)
    .values({ ...input, position: Number(next) })
    .returning();
  return toQuickLink(row);
}

export async function updateQuickLink(id: string, input: QuickLinkInput, db: Db = defaultDb()): Promise<void> {
  const res = await db.update(quickLinks).set(input).where(eq(quickLinks.id, id)).returning({ id: quickLinks.id });
  if (!res.length) throw new Error("Link not found");
}

export async function deleteQuickLink(id: string, db: Db = defaultDb()): Promise<void> {
  await db.delete(quickLinks).where(eq(quickLinks.id, id));
}

/** Swaps a link with the nearest link in the same group, since that is the neighbour shown on screen. */
export async function moveQuickLink(id: string, direction: "up" | "down", db: Db = defaultDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: quickLinks.id, group: quickLinks.group })
      .from(quickLinks)
      .orderBy(asc(quickLinks.position), asc(quickLinks.createdAt));
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const step = direction === "up" ? -1 : 1;
    let j = i + step;
    while (j >= 0 && j < rows.length && rows[j].group !== rows[i].group) j += step;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    // Renumber everything so positions stay dense even after deletes.
    for (const [position, r] of rows.entries()) {
      await tx.update(quickLinks).set({ position }).where(eq(quickLinks.id, r.id));
    }
  });
}

export async function markQuickLinksOpened(ids: string[], db: Db = defaultDb()): Promise<void> {
  if (!ids.length) return;
  await db.update(quickLinks).set({ lastOpenedAt: new Date() }).where(inArray(quickLinks.id, ids));
}
