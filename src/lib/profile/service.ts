import { desc, eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { profileVersions, type ProfileVersionRow } from "@/lib/db/schema";
import {
  emptyInstructions,
  emptyPreferences,
  emptyProfile,
  GenerationInstructionsSchema,
  PreferencesSchema,
  ProfileSchema,
} from "./schema";

export type ProfileChanges = {
  profile?: unknown;
  preferences?: unknown;
  generationInstructions?: unknown;
  baseResumeFileId?: string | null;
  changeNote?: string;
};

export async function getLatest(db: Db = defaultDb()): Promise<ProfileVersionRow | null> {
  const [row] = await db
    .select()
    .from(profileVersions)
    .orderBy(desc(profileVersions.version))
    .limit(1);
  return row ?? null;
}

export async function listVersions(db: Db = defaultDb()) {
  return db
    .select({
      id: profileVersions.id,
      version: profileVersions.version,
      changeNote: profileVersions.changeNote,
      createdAt: profileVersions.createdAt,
    })
    .from(profileVersions)
    .orderBy(desc(profileVersions.version));
}

export async function getVersion(id: string, db: Db = defaultDb()) {
  const [row] = await db.select().from(profileVersions).where(eq(profileVersions.id, id));
  return row ?? null;
}

/**
 * Saves a new immutable version. Only the parts passed in `changes` are replaced;
 * everything else is carried over from the latest version.
 */
export async function saveVersion(
  changes: ProfileChanges,
  db: Db = defaultDb(),
): Promise<ProfileVersionRow> {
  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select()
      .from(profileVersions)
      .orderBy(desc(profileVersions.version))
      .limit(1);

    const [row] = await tx
      .insert(profileVersions)
      .values({
        version: (latest?.version ?? 0) + 1,
        profile:
          changes.profile !== undefined
            ? ProfileSchema.parse(changes.profile)
            : (latest?.profile ?? emptyProfile()),
        preferences:
          changes.preferences !== undefined
            ? PreferencesSchema.parse(changes.preferences)
            : (latest?.preferences ?? emptyPreferences()),
        generationInstructions:
          changes.generationInstructions !== undefined
            ? GenerationInstructionsSchema.parse(changes.generationInstructions)
            : (latest?.generationInstructions ?? emptyInstructions()),
        baseResumeFileId:
          changes.baseResumeFileId !== undefined
            ? changes.baseResumeFileId
            : (latest?.baseResumeFileId ?? null),
        changeNote: changes.changeNote ?? null,
      })
      .returning();
    return row;
  });
}

/** Restoring never rewrites history: it saves the old content as a new version. */
export async function restoreVersion(id: string, db: Db = defaultDb()) {
  const old = await getVersion(id, db);
  if (!old) throw new Error("Version not found");
  return saveVersion(
    {
      profile: old.profile,
      preferences: old.preferences,
      generationInstructions: old.generationInstructions,
      baseResumeFileId: old.baseResumeFileId,
      changeNote: `Restored from version ${old.version}`,
    },
    db,
  );
}
