import { desc } from "drizzle-orm";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { db } from "@/lib/db";
import { profileVersions } from "@/lib/db/schema";
import { getBaseDocument } from "@/lib/documents/service";
import {
  emptyInstructions,
  emptyPreferences,
  emptyProfile,
} from "@/lib/profile/schema";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const database = db();
  const [versions, base] = await Promise.all([
    database.select().from(profileVersions).orderBy(desc(profileVersions.version)),
    getBaseDocument(database),
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
        baseDocument={base ? { id: base.id, title: base.title } : null}
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
      />
    </div>
  );
}
