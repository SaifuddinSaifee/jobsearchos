"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { pastResumes } from "@/lib/db/schema";
import { restoreVersion, saveVersion } from "@/lib/profile/service";

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
  return run(() =>
    saveVersion({ profile, baseResumeFileId, changeNote: changeNote ?? "Profile updated" }),
  );
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
