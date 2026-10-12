"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { disconnect, sendTestEmail } from "@/lib/email/gmail";
import { checkProviders, type ProviderStatus } from "@/lib/email/providers";
import { saveColdEmailSettings } from "@/lib/email/settings";

export type SettingsResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function run<T extends object>(fn: () => Promise<T>, fallback: string): Promise<SettingsResult<T>> {
  try {
    const value = await fn();
    revalidatePath("/settings");
    return { ok: true, ...value };
  } catch (err) {
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? fallback };
    return { ok: false, error: err instanceof Error ? err.message : fallback };
  }
}

export async function saveColdEmailSettingsAction(settings: unknown) {
  return run(async () => {
    await saveColdEmailSettings(settings);
    return {};
  }, "Save failed");
}

export async function disconnectGmailAction() {
  return run(async () => {
    await disconnect();
    return {};
  }, "Disconnect failed");
}

export async function sendTestEmailAction() {
  return run(async () => {
    await sendTestEmail();
    return {};
  }, "Could not send the test email");
}

export async function checkContactProvidersAction(): Promise<SettingsResult<{ statuses: ProviderStatus[] }>> {
  return run(async () => ({ statuses: await checkProviders() }), "Check failed");
}
