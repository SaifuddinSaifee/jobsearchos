import { db as defaultDb, type Db } from "@/lib/db";
import type { DocumentRow } from "@/lib/db/schema";
import type { Profile } from "@/lib/profile/schema";
import { profileToDoc } from "./convert/profile-to-doc";
import { enqueueAfterCreate } from "./queue";
import { createDocument, getBaseDocument } from "./service";

const hasContent = (p: Profile) => p.summary.trim() !== "" || p.experience.length > 0 || p.projects.length > 0 || p.education.length > 0 || p.skills.length > 0;

/** Where an imported resume came from. The file itself is not kept. */
export type ImportedSource = { name: string; mime: string; sha256: string };

/**
 * Keeps the base resume in step with the profile at the moments that matter. Importing a resume file on the Profile
 * page makes a new base resume from the reviewed profile (the old base stays in the library as an ordinary resume).
 * A plain profile edit does not touch it, except that a base is made if there is none yet. Returns the new document.
 */
export async function syncBaseFromProfile(profile: Profile, imported: ImportedSource | null | undefined, db: Db = defaultDb()): Promise<DocumentRow | null> {
  const existing = await getBaseDocument(db);
  if (!imported && (existing || !hasContent(profile))) return null;

  const title = existing ? `Base resume, ${new Date().toISOString().slice(0, 10)}` : "Base resume";
  const { document } = await createDocument(
    {
      kind: "resume",
      origin: imported ? "uploaded" : "blank",
      title,
      content: profileToDoc(profile),
      isBase: true,
      sourceName: imported?.name ?? null,
      sourceMime: imported?.mime ?? null,
      sourceSha256: imported?.sha256 ?? null,
    },
    db,
  );
  await enqueueAfterCreate(document.id, db);
  return document;
}
