import { desc } from "drizzle-orm";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { db } from "@/lib/db";
import { pastResumes, profileVersions } from "@/lib/db/schema";
import {
  emptyInstructions,
  emptyPreferences,
  emptyProfile,
} from "@/lib/profile/schema";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const database = db();
  const [versions, resumes] = await Promise.all([
    database.select().from(profileVersions).orderBy(desc(profileVersions.version)),
    database.select().from(pastResumes).orderBy(desc(pastResumes.createdAt)),
  ]);
  const latest = versions[0];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {latest
          ? `Version ${latest.version} · saved ${latest.createdAt.toLocaleString()}`
          : "Not saved yet"}
      </p>
      <ProfileTabs
        profile={latest?.profile ?? emptyProfile()}
        preferences={latest?.preferences ?? emptyPreferences()}
        instructions={latest?.generationInstructions ?? emptyInstructions()}
        hasProfile={Boolean(latest)}
        baseResumeFileId={latest?.baseResumeFileId ?? null}
        latestVersion={latest?.version ?? 0}
        versions={versions.map((v) => ({
          id: v.id,
          version: v.version,
          changeNote: v.changeNote,
          createdAt: v.createdAt.toISOString(),
          data: JSON.stringify(
            {
              profile: v.profile,
              preferences: v.preferences,
              generationInstructions: v.generationInstructions,
            },
            null,
            2,
          ),
        }))}
        pastResumes={resumes.map((r) => ({
          id: r.id,
          title: r.title,
          company: r.company,
          role: r.role,
          appliedAt: r.appliedAt?.toISOString() ?? null,
          hasJd: Boolean(r.jdText),
          chars: r.extractedText.length,
        }))}
      />
    </div>
  );
}
