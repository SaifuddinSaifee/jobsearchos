"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["general", "email"] as const;

export function SettingsTabs({ general, email }: { general: ReactNode; email: ReactNode }) {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("general"));

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="email">Email</TabsTrigger>
      </TabsList>
      <TabsContent value="general" className="pt-4">
        {general}
      </TabsContent>
      <TabsContent value="email" className="space-y-4 pt-4">
        {email}
      </TabsContent>
    </Tabs>
  );
}
