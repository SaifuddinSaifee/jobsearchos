import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { connectWithCode, STATE_COOKIE } from "@/lib/email/gmail";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

function back(result: "connected" | "error", reason?: string) {
  const url = new URL("/settings", env().APP_URL);
  url.searchParams.set("tab", "email");
  url.searchParams.set("gmail", result);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  const denied = params.get("error");
  if (denied) return back("error", denied === "access_denied" ? "Access was not granted" : denied);

  const state = params.get("state");
  const code = params.get("code");
  if (!expected || !state || !sameState(state, expected)) {
    return back("error", "The sign-in request could not be verified. Try connecting again.");
  }
  if (!code) return back("error", "Google did not send a code");

  try {
    await connectWithCode(code);
    return back("connected");
  } catch (err) {
    return back("error", err instanceof Error ? err.message : "Could not connect Gmail");
  }
}
