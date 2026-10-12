"use client";

import { CheckCircle2, Mail, Send, Unplug } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { disconnectGmailAction, sendTestEmailAction } from "@/app/(app)/settings/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GoogleButton } from "./google-button";

export type GmailState = {
  /** Env variables still missing; empty when the app can start the Google sign-in. */
  missing: string[];
  redirectUri: string;
  /** Show the developer setup steps (development builds only; public users never see .env details). */
  showSetup: boolean;
  account: { email: string; scopes: string[]; connectedAt: string; needsReconnect: boolean } | null;
};

const scopeLabel = (scope: string): string | null =>
  scope.endsWith("/gmail.send") ? "Send email" : scope.endsWith("/gmail.readonly") ? "Read email" : null;

/** What the Google consent screen will ask for, in plain words, shown before the user is sent there. */
function AccessExplainer() {
  return (
    <ul className="space-y-1 text-sm text-muted-foreground">
      <li>
        <span className="font-medium text-foreground">Send email</span> as you, only when you click Send on an email you have reviewed.
      </li>
      <li>
        <span className="font-medium text-foreground">Read email</span> to notice replies and the job opportunities that reach your inbox,
        such as newsletters and recruiter messages.
      </li>
    </ul>
  );
}

function SetupSteps({ missing, redirectUri }: { missing: string[]; redirectUri: string }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Add {missing.map((m, i) => (
          <span key={m}>
            {i > 0 ? ", " : ""}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{m}</code>
          </span>
        ))}{" "}
        to <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code> and restart the app.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Create a Google Cloud project and enable the Gmail API.</li>
        <li>Set up the OAuth consent screen in Testing mode and add your own address as a test user.</li>
        <li>
          Create an OAuth client of type Web application with the redirect URI{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{redirectUri}</code>.
        </li>
        <li>
          Copy the client ID and secret into <code className="rounded bg-muted px-1 py-0.5 text-xs">.env</code>. Generate the encryption key
          with <code className="rounded bg-muted px-1 py-0.5 text-xs">openssl rand -base64 32</code>.
        </li>
      </ol>
    </div>
  );
}

export function GmailCard({ state }: { state: GmailState }) {
  const [result, setResult] = useQueryState("gmail");
  const [reason, setReason] = useQueryState("reason");
  const [connecting, setConnecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testing, startTesting] = useTransition();
  const [disconnecting, startDisconnecting] = useTransition();
  const { account } = state;

  // Report how the Google sign-in ended, once, then clear the parameters so a reload does not repeat it.
  useEffect(() => {
    if (!result) return;
    if (result === "connected") toast.success("Gmail connected");
    else toast.error(reason ?? "Could not connect Gmail");
    void setResult(null);
    void setReason(null);
  }, [result, reason, setResult, setReason]);

  const connect = () => {
    setConnecting(true);
    // A full page load on purpose: the route hands the browser over to Google, which is not a Next.js page.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/gmail/connect";
  };

  const sendTest = () =>
    startTesting(async () => {
      const res = await sendTestEmailAction();
      if (res.ok) toast.success(`Test email sent to ${account?.email}`);
      else toast.error(res.error);
    });

  const confirmDisconnect = () =>
    startDisconnecting(async () => {
      const res = await disconnectGmailAction();
      if (res.ok) {
        setConfirmOpen(false);
        toast.success("Gmail disconnected");
      } else toast.error(res.error);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4" aria-hidden /> Gmail
          {account && !account.needsReconnect ? <Badge variant="secondary">Connected</Badge> : null}
          {account?.needsReconnect ? <Badge variant="destructive">Reconnect needed</Badge> : null}
        </CardTitle>
        <CardDescription>
          Send cold emails from your own address and keep track of replies. Nothing is sent without your click, and your Google login is
          stored encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.missing.length > 0 ? (
          state.showSetup ? (
            <SetupSteps missing={state.missing} redirectUri={state.redirectUri} />
          ) : (
            <p className="text-sm text-muted-foreground">Connecting Gmail is not available right now. Please try again later.</p>
          )
        ) : !account ? (
          <div className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
            <AccessExplainer />
            <GoogleButton onClick={connect} loading={connecting} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-green-600" aria-hidden />
              <span className="font-medium">{account.email}</span>
              <span className="text-muted-foreground">connected {new Date(account.connectedAt).toLocaleDateString()}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {account.scopes.map(scopeLabel).filter((l): l is string => l !== null).map((l) => (
                <Badge key={l} variant="outline">
                  {l}
                </Badge>
              ))}
            </div>
            {account.needsReconnect ? (
              <p className="text-sm text-muted-foreground">
                Google asked you to sign in again. Reconnect to keep sending and tracking replies.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {account.needsReconnect ? (
                <GoogleButton onClick={connect} loading={connecting} label="Reconnect with Google" />
              ) : (
                <Button variant="outline" onClick={sendTest} loading={testing}>
                  <Send /> {testing ? "Sending..." : "Send test email"}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setConfirmOpen(true)}>
                <Unplug /> Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Gmail?</DialogTitle>
            <DialogDescription>
              The app loses access to {account?.email}. Sent emails and their history stay. You can connect again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDisconnect} loading={disconnecting}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
