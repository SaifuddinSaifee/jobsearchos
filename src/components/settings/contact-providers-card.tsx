"use client";

import { CircleAlert, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { checkContactProvidersAction } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProviderStatus } from "@/lib/email/providers";

const NAMES = { hunter: "Hunter.io", apollo: "Apollo.io" } as const;

export function ContactProvidersCard({ keys }: { keys: Record<"hunter" | "apollo", boolean> }) {
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [pending, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      const res = await checkContactProvidersAction();
      if (res.ok) setStatuses(res.statuses);
      else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden /> Contact finders
        </CardTitle>
        <CardDescription>
          Used to look up the right person at a company and verify their address. Keys live in <code>.env</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {(["hunter", "apollo"] as const).map((p) => {
          const status = statuses?.find((s) => s.provider === p);
          const Icon = status ? (status.ok ? CircleCheck : CircleAlert) : CircleDashed;
          return (
            <div key={p} className="flex items-start gap-3 text-sm">
              <Icon
                className={`mt-0.5 size-4 transition-colors ${status?.ok ? "text-green-600" : status ? "text-destructive" : "text-muted-foreground"}`}
                aria-hidden
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 font-medium">
                  {NAMES[p]}
                  <Badge variant={keys[p] ? "secondary" : "outline"}>{keys[p] ? "Key set" : "Not set"}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {status ? status.detail : keys[p] ? "Press Check to test the key." : `Add ${p.toUpperCase()}_API_KEY to .env.`}
                </div>
              </div>
            </div>
          );
        })}
        <Button variant="outline" onClick={check} loading={pending} disabled={!keys.hunter && !keys.apollo}>
          {pending ? "Checking..." : "Check keys"}
        </Button>
      </CardContent>
    </Card>
  );
}
