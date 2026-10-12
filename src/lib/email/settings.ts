import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { ColdEmailSettingsSchema, defaultColdEmailSettings, type ColdEmailSettings } from "./settings-schema";

export * from "./settings-schema";

const ID = "default";

/** Saved settings merged over the defaults, so fields added later still get a value. */
export async function getColdEmailSettings(db: Db = defaultDb()): Promise<ColdEmailSettings> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, ID));
  const parsed = ColdEmailSettingsSchema.safeParse({ ...defaultColdEmailSettings(), ...row?.coldEmail });
  return parsed.success ? parsed.data : defaultColdEmailSettings();
}

export async function saveColdEmailSettings(input: unknown, db: Db = defaultDb()): Promise<ColdEmailSettings> {
  const coldEmail = ColdEmailSettingsSchema.parse(input);
  await db
    .insert(appSettings)
    .values({ id: ID, coldEmail })
    .onConflictDoUpdate({ target: appSettings.id, set: { coldEmail, updatedAt: new Date() } });
  return coldEmail;
}
