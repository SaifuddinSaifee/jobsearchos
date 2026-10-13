"use server";

import { revalidatePath } from "next/cache";
import { syncBaseFromProfile, type ImportedSource } from "@/lib/documents/base";
import { ProfileSchema } from "@/lib/profile/schema";
import { restoreVersion, saveVersion } from "@/lib/profile/service";

export type ActionResult = { ok: true; version: number } | { ok: false; error: string };

async function run(fn: () => Promise<{ version: number }>): Promise<ActionResult> {
  try {
    const row = await fn();
    revalidatePath("/profile");
    revalidatePath("/library");
    return { ok: true, version: row.version };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}

/**
 * Saves the profile as a new version. `imported` is set when it came from importing a resume file: that makes a
 * new base resume in the library from the reviewed profile. Editing a profile that was already saved leaves the base
 * resume document alone (open it in the library to change it).
 */
export async function saveProfileAction(
  profile: unknown,
  imported?: ImportedSource | null,
  changeNote?: string,
) {
  return run(async () => {
    const row = await saveVersion({ profile, changeNote: changeNote ?? "Profile updated" });
    // A failed library step must not undo a profile that was saved.
    await syncBaseFromProfile(ProfileSchema.parse(profile), imported).catch((err) => console.error("[profile] base resume sync failed:", err));
    return row;
  });
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
