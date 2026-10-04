import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { files, type FileRow } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type StorageOptions = { dir?: string; db?: Db };

function filePath(dir: string, sha256: string) {
  return path.join(dir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

/**
 * Content-addressed, write-once storage. Identical bytes map to one file and
 * one `files` row; existing content is never overwritten.
 */
export async function putFile(
  bytes: Buffer,
  meta: { mime: string; originalName?: string },
  opts: StorageOptions = {},
): Promise<FileRow> {
  const dir = opts.dir ?? env().STORAGE_DIR;
  const db = opts.db ?? defaultDb();
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [existing] = await db.select().from(files).where(eq(files.sha256, sha256));
  if (existing) return existing;

  const target = filePath(dir, sha256);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  const [row] = await db
    .insert(files)
    .values({
      sha256,
      mime: meta.mime,
      size: bytes.length,
      originalName: meta.originalName ?? null,
      path: target,
    })
    .onConflictDoNothing({ target: files.sha256 })
    .returning();
  if (row) return row;

  const [raced] = await db.select().from(files).where(eq(files.sha256, sha256));
  return raced;
}

export async function getFileBytes(sha256: string, opts: StorageOptions = {}) {
  const dir = opts.dir ?? env().STORAGE_DIR;
  return readFile(filePath(dir, sha256));
}
