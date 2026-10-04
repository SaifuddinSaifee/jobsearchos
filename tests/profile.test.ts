import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { profileVersions } from "@/lib/db/schema";
import {
  getLatest,
  listVersions,
  restoreVersion,
  saveVersion,
} from "@/lib/profile/service";
import { emptyPreferences, emptyProfile } from "@/lib/profile/schema";
import { resetDb, testDb } from "./helpers";

const db = testDb();

beforeEach(() => resetDb(db));
afterAll(() => db.$client.end());

describe("profile versions", () => {
  it("increments versions and carries over untouched parts", async () => {
    const profile = { ...emptyProfile(), summary: "Backend engineer" };
    const v1 = await saveVersion({ profile }, db);
    const v2 = await saveVersion(
      { preferences: { ...emptyPreferences(), targetRoles: ["Backend"] } },
      db,
    );

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.profile.summary).toBe("Backend engineer");
    expect(v2.preferences.targetRoles).toEqual(["Backend"]);
    expect((await getLatest(db))?.version).toBe(2);
    expect(await listVersions(db)).toHaveLength(2);
  });

  it("rejects invalid data", async () => {
    await expect(saveVersion({ profile: { nope: true } }, db)).rejects.toThrow();
  });

  it("restores an old version as a new version", async () => {
    const v1 = await saveVersion({ profile: { ...emptyProfile(), summary: "A" } }, db);
    await saveVersion({ profile: { ...emptyProfile(), summary: "B" } }, db);
    const v3 = await restoreVersion(v1.id, db);

    expect(v3.version).toBe(3);
    expect(v3.profile.summary).toBe("A");
    expect(v3.changeNote).toBe("Restored from version 1");
  });

  it("blocks UPDATE and DELETE at the database level", async () => {
    await saveVersion({ profile: emptyProfile() }, db);
    // Drizzle wraps the Postgres error; the trigger's message is on `cause`.
    const causeOf = async (p: PromiseLike<unknown>) => {
      try {
        await p;
      } catch (err) {
        return String((err as Error & { cause?: Error }).cause?.message);
      }
      return "no error";
    };
    expect(await causeOf(db.update(profileVersions).set({ changeNote: "tamper" }))).toMatch(
      /immutable/,
    );
    expect(await causeOf(db.delete(profileVersions))).toMatch(/immutable/);
    const [{ count }] = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM profile_versions`,
    );
    expect(count).toBe("1");
  });
});
