import { env } from "@/lib/env";
import { accountInfo, ProspeoError } from "@/lib/outreach/prospeo";

export type ProviderStatus = { provider: "prospeo"; configured: boolean; ok: boolean | null; detail: string };

/** Which contact-finder keys are set, without calling anything. */
export function providerKeys(): { prospeo: boolean } {
  return { prospeo: Boolean(env().PROSPEO_API_KEY) };
}

/** Calls the provider's account endpoint to confirm the key works. */
export async function checkProviders(): Promise<ProviderStatus[]> {
  const key = env().PROSPEO_API_KEY;
  if (!key) return [{ provider: "prospeo", configured: false, ok: null, detail: "Not set up. Add PROSPEO_API_KEY to .env." }];
  try {
    await accountInfo(key);
    return [{ provider: "prospeo", configured: true, ok: true, detail: "Key works." }];
  } catch (err) {
    const detail = err instanceof ProspeoError ? err.message : "Could not reach Prospeo. Try again in a moment.";
    return [{ provider: "prospeo", configured: true, ok: false, detail }];
  }
}
