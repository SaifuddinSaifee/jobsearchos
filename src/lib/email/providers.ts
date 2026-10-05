import { env } from "@/lib/env";

export type ProviderStatus = {
  provider: "hunter" | "apollo";
  configured: boolean;
  ok: boolean | null;
  detail: string;
};

/** Which contact-finder keys are set, without calling anything. */
export function providerKeys(): Record<"hunter" | "apollo", boolean> {
  const e = env();
  return { hunter: Boolean(e.HUNTER_API_KEY), apollo: Boolean(e.APOLLO_API_KEY) };
}

async function checkHunter(key: string): Promise<ProviderStatus> {
  const res = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`);
  const json = (await res.json().catch(() => ({}))) as {
    data?: { requests?: { searches?: { used?: number; available?: number }; verifications?: { used?: number; available?: number } } };
    errors?: { details?: string }[];
  };
  if (!res.ok) {
    return { provider: "hunter", configured: true, ok: false, detail: json.errors?.[0]?.details ?? `Hunter rejected the key (${res.status})` };
  }
  const s = json.data?.requests?.searches;
  const v = json.data?.requests?.verifications;
  const left = (x?: { used?: number; available?: number }) => (x?.available != null && x.used != null ? x.available - x.used : null);
  const parts = [left(s) != null ? `${left(s)} searches left` : null, left(v) != null ? `${left(v)} verifications left` : null].filter(Boolean);
  return { provider: "hunter", configured: true, ok: true, detail: parts.length ? `Key works. ${parts.join(", ")}.` : "Key works." };
}

async function checkApollo(key: string): Promise<ProviderStatus> {
  const res = await fetch("https://api.apollo.io/v1/auth/health", { headers: { "x-api-key": key, "Cache-Control": "no-cache" } });
  const json = (await res.json().catch(() => ({}))) as { is_logged_in?: boolean; error?: string };
  const ok = res.ok && json.is_logged_in !== false;
  return {
    provider: "apollo",
    configured: true,
    ok,
    detail: ok ? "Key works." : (json.error ?? `Apollo rejected the key (${res.status})`),
  };
}

/** Calls each configured provider's account endpoint to confirm the key works. */
export async function checkProviders(): Promise<ProviderStatus[]> {
  const e = env();
  const run = async (provider: "hunter" | "apollo", key: string | undefined, check: (k: string) => Promise<ProviderStatus>) => {
    if (!key) return { provider, configured: false, ok: null, detail: `Not set up. Add ${provider.toUpperCase()}_API_KEY to .env.` } satisfies ProviderStatus;
    try {
      return await check(key);
    } catch (err) {
      return { provider, configured: true, ok: false, detail: err instanceof Error ? err.message : "Request failed" } satisfies ProviderStatus;
    }
  };
  return Promise.all([run("hunter", e.HUNTER_API_KEY, checkHunter), run("apollo", e.APOLLO_API_KEY, checkApollo)]);
}
