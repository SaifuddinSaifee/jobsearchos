"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { pastResumes } from "@/lib/db/schema";
import { restoreVersion, saveVersion } from "@/lib/profile/service";
import { kickWorker } from "@/lib/queue/worker";
import { enqueueResumeIndex } from "@/lib/resume/indexing";

export type ActionResult = { ok: true; version: number } | { ok: false; error: string };

async function run(fn: () => Promise<{ version: number }>): Promise<ActionResult> {
  try {
    const row = await fn();
    revalidatePath("/profile");
    return { ok: true, version: row.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}

export async function saveProfileAction(
  profile: unknown,
  baseResumeFileId?: string | null,
  changeNote?: string,
) {
  return run(async () => {
    const row = await saveVersion({ profile, baseResumeFileId, changeNote: changeNote ?? "Profile updated" });
    // The base resume is searchable material too. A failed queue attempt must not fail the save.
    if (row.baseResumeFileId) await enqueueResumeIndex(row.baseResumeFileId).then(() => kickWorker()).catch(() => {});
    return row;
  });
}

/** Starts (or retries) the search index for one resume file. */
export async function indexResumeAction(fileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await enqueueResumeIndex(z.uuid().parse(fileId));
    kickWorker();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not start indexing" };
  }
}

export async function savePreferencesAction(preferences: unknown) {
  return run(() => saveVersion({ preferences, changeNote: "Preferences updated" }));
}

export async function saveInstructionsAction(generationInstructions: unknown) {
  return run(() =>
    saveVersion({ generationInstructions, changeNote: "Generation instructions updated" }),
  );
}

export async function restoreVersionAction(id: string) {
  return run(() => restoreVersion(id));
}

export async function deletePastResumeAction(id: string) {
  await db().delete(pastResumes).where(eq(pastResumes.id, id));
  revalidatePath("/profile");
}
