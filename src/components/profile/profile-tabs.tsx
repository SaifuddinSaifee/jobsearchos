"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GenerationInstructions, Preferences, Profile } from "@/lib/profile/schema";
import { History, type VersionRow } from "./history";
import { InstructionsForm } from "./instructions-form";
import { PastResumes, type PastResumeSummary } from "./past-resumes";
import { PreferencesForm } from "./preferences-form";
import { ProfileTab } from "./profile-tab";

const TABS = ["profile", "preferences", "instructions", "past-resumes", "history"] as const;

export function ProfileTabs(props: {
  profile: Profile;
  preferences: Preferences;
  instructions: GenerationInstructions;
  hasProfile: boolean;
  baseResumeFileId: string | null;
  latestVersion: number;
  versions: VersionRow[];
  pastResumes: PastResumeSummary[];
}) {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("profile"),
  );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
      <TabsList>
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="preferences">Preferences</TabsTrigger>
        <TabsTrigger value="instructions">Generation instructions</TabsTrigger>
        <TabsTrigger value="past-resumes">Past resumes</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="pt-4">
        <ProfileTab
          profile={props.profile}
          hasProfile={props.hasProfile}
          baseResumeFileId={props.baseResumeFileId}
        />
      </TabsContent>
      <TabsContent value="preferences" className="pt-4">
        <PreferencesForm initial={props.preferences} />
      </TabsContent>
      <TabsContent value="instructions" className="pt-4">
        <InstructionsForm initial={props.instructions} />
      </TabsContent>
      <TabsContent value="past-resumes" className="pt-4">
        <PastResumes rows={props.pastResumes} />
      </TabsContent>
      <TabsContent value="history" className="pt-4">
        <History versions={props.versions} latest={props.latestVersion} />
      </TabsContent>
    </Tabs>
  );
}
