import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDb } from "@/lib/db";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://jobtracker:jobtracker@localhost:5432/jobtracker_test";

export function testDb() {
  return createDb(TEST_URL);
}

/** profile_versions is immutable (trigger blocks DELETE), so TRUNCATE is the only reset. */
export async function resetDb(db: ReturnType<typeof testDb>) {
  await db.execute(
    sql`TRUNCATE profile_versions, past_resumes, files RESTART IDENTITY CASCADE`,
  );
}
