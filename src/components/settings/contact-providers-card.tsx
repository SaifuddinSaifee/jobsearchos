"use client";

import { CircleAlert, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { checkContactProvidersAction } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProviderStatus } from "@/lib/email/providers";

export function ContactProvidersCard({ keys }: { keys: { prospeo: boolean } }) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [pending, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      const res = await checkContactProvidersAction();
      if (res.ok) setStatus(res.statuses[0] ?? null);
      else toast.error(res.error);
    });

  const Icon = status ? (status.ok ? CircleCheck : CircleAlert) : CircleDashed;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden /> Contact finder
        </CardTitle>
        <CardDescription>
          Prospeo finds people at a company and reveals their verified work email. The key lives in <code>.env</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3 text-sm">
          <Icon
            className={`mt-0.5 size-4 transition-colors ${status?.ok ? "text-green-600" : status ? "text-destructive" : "text-muted-foreground"}`}
            aria-hidden
          />
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 font-medium">
              Prospeo
              <Badge variant={keys.prospeo ? "secondary" : "outline"}>{keys.prospeo ? "Key set" : "Not set"}</Badge>
            </div>
            <div className="text-muted-foreground">
              {status ? status.detail : keys.prospeo ? "Press Check to test the key." : "Add PROSPEO_API_KEY to .env."}
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={check} loading={pending} disabled={!keys.prospeo}>
          {pending ? "Checking..." : "Check key"}
        </Button>
      </CardContent>
    </Card>
  );
}
