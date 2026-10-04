import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getFileBytes, putFile } from "@/lib/storage/local";
import { resetDb, testDb } from "./helpers";

const db = testDb();
let dir: string;

beforeEach(async () => {
  await resetDb(db);
  dir = await mkdtemp(path.join(tmpdir(), "jt-storage-"));
});
afterAll(async () => {
  await db.$client.end();
});

describe("local storage", () => {
  it("stores bytes by hash and reads them back", async () => {
    const bytes = Buffer.from("hello resume");
    const row = await putFile(bytes, { mime: "text/plain", originalName: "a.txt" }, { dir, db });

    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(row.path)).toEqual(bytes);
    expect(await getFileBytes(row.sha256, { dir })).toEqual(bytes);
    await rm(dir, { recursive: true });
  });

  it("deduplicates identical content", async () => {
    const bytes = Buffer.from("same bytes");
    const a = await putFile(bytes, { mime: "text/plain" }, { dir, db });
    const b = await putFile(bytes, { mime: "text/plain", originalName: "other.txt" }, { dir, db });

    expect(b.id).toBe(a.id);
    await rm(dir, { recursive: true });
  });
});
