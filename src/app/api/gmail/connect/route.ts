import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authUrl, missingConfig, STATE_COOKIE } from "@/lib/email/gmail";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Starts the Google consent flow. A random `state` in an httpOnly cookie guards the callback against forged requests. */
export async function GET() {
  const missing = missingConfig();
  if (missing.length > 0) {
    return NextResponse.redirect(
      new URL(`/settings?tab=email&gmail=error&reason=${encodeURIComponent(`Missing ${missing.join(", ")}`)}`, env().APP_URL),
    );
  }
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    maxAge: 600,
    path: "/api/gmail",
  });
  return NextResponse.redirect(authUrl(state));
}
