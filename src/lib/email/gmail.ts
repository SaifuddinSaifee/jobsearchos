import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/lib/db";
import { emailAccounts, type EmailAccountRow } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { MAX_ATTACHMENT_BYTES } from "@/lib/outreach/types";
import { decrypt, encrypt } from "./crypto";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export const STATE_COOKIE = "gmail_oauth_state";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** Refresh a little early so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/** The refresh token was rejected (revoked, or expired: in Testing mode Google expires them after 7 days). */
export class ReconnectRequiredError extends Error {
  constructor() {
    super("Google rejected the saved Gmail login. Reconnect Gmail in Settings.");
  }
}

export function redirectUri(): string {
  return `${env().APP_URL.replace(/\/$/, "")}/api/gmail/callback`;
}

/** Names the env variables that are missing, so Settings can say exactly what to add. */
export function missingConfig(): string[] {
  const e = env();
  const missing: string[] = [];
  if (!e.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!e.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!e.TOKEN_ENCRYPTION_KEY) missing.push("TOKEN_ENCRYPTION_KEY");
  return missing;
}

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const e = env();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e.GOOGLE_CLIENT_ID ?? "",
      client_secret: e.GOOGLE_CLIENT_SECRET ?? "",
      ...body,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    if (json.error === "invalid_grant") throw new ReconnectRequiredError();
    throw new Error(`Google token request failed: ${json.error_description ?? json.error ?? res.statusText}`);
  }
  return json;
}

/** Trades the code from the OAuth callback for tokens and stores the account, replacing any active one. */
export async function connectWithCode(code: string, db: Db = defaultDb()): Promise<EmailAccountRow> {
  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
  if (!tokens.access_token) throw new Error("Google did not return an access token");
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  const scopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.some((s) => s.endsWith("/gmail.send"))) {
    throw new Error("Permission to send email was not granted. Connect again and allow it.");
  }

  const info = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const email = ((await info.json().catch(() => ({}))) as { email?: string }).email;
  if (!info.ok || !email) throw new Error("Could not read the Gmail address from Google");

  return db.transaction(async (tx) => {
    await tx
      .update(emailAccounts)
      .set({ disconnectedAt: new Date() })
      .where(and(eq(emailAccounts.provider, "gmail"), isNull(emailAccounts.disconnectedAt)));
    const [row] = await tx
      .insert(emailAccounts)
      .values({
        provider: "gmail",
        email,
        scopes,
        refreshTokenEnc: encrypt(tokens.refresh_token!),
        accessTokenEnc: encrypt(tokens.access_token!),
        accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      })
      .returning();
    return row;
  });
}

export async function connectedAccount(db: Db = defaultDb()): Promise<EmailAccountRow | null> {
  const [row] = await db
    .select()
    .from(emailAccounts)
    .where(and(eq(emailAccounts.provider, "gmail"), isNull(emailAccounts.disconnectedAt)));
  return row ?? null;
}

/** A valid access token for the connected account, refreshed (and saved) when it has expired. */
export async function getAccessToken(db: Db = defaultDb()): Promise<{ token: string; account: EmailAccountRow }> {
  const account = await connectedAccount(db);
  if (!account) throw new Error("Gmail is not connected");
  if (account.needsReconnect) throw new ReconnectRequiredError();

  const fresh =
    account.accessTokenEnc &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();
  if (fresh) return { token: decrypt(account.accessTokenEnc!), account };

  try {
    const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(account.refreshTokenEnc) });
    if (!tokens.access_token) throw new Error("Google did not return an access token");
    await db
      .update(emailAccounts)
      .set({
        accessTokenEnc: encrypt(tokens.access_token),
        accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      })
      .where(eq(emailAccounts.id, account.id));
    return { token: tokens.access_token, account };
  } catch (err) {
    if (err instanceof ReconnectRequiredError) {
      await db.update(emailAccounts).set({ needsReconnect: true }).where(eq(emailAccounts.id, account.id));
    }
    throw err;
  }
}

/** Revokes the grant at Google (best effort) and marks the account disconnected. */
export async function disconnect(db: Db = defaultDb()): Promise<void> {
  const account = await connectedAccount(db);
  if (!account) return;
  try {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decrypt(account.refreshTokenEnc) }),
    });
  } catch {
    // Already revoked, offline or the key changed: the local record still has to go.
  }
  await db.update(emailAccounts).set({ disconnectedAt: new Date() }).where(eq(emailAccounts.id, account.id));
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  body: string;
  from?: string;
  bcc?: string;
  /** Set to reply inside an existing thread. */
  threadId?: string;
  inReplyTo?: string;
  /** The same email with its formatting. When set, `body` goes along as the plain-text alternative. */
  html?: string;
  attachments?: OutgoingAttachment[];
};

export type OutgoingAttachment = { filename: string; mime: string; content: Buffer };

/** Gmail's JSON send endpoint is documented for small messages; resumes are far below this. Base64 adds a third. */
export { MAX_ATTACHMENT_BYTES };

const stripBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Non-ASCII subjects need RFC 2047 encoding. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n");

/** A file name as a quoted header parameter: plain when ASCII, RFC 2047 encoded otherwise (understood by Gmail and Outlook). */
function fileNameParam(name: string): string {
  const safe = stripBreaks(name).replace(/["\\]/g, "_") || "attachment";
  return `"${encodeHeader(safe)}"`;
}

const base64Text = (s: string) => wrap76(Buffer.from(s.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"));
const newBoundary = () => `=_jobsearchos_${randomUUID().replaceAll("-", "")}`;

/** One MIME entity: its headers, a blank line, its body. */
type Entity = { headers: string[]; body: string };

const multipart = (subtype: "mixed" | "alternative", parts: Entity[]): Entity => {
  const boundary = newBoundary();
  return {
    headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`],
    body: `${parts.map((p) => `--${boundary}\r\n${p.headers.join("\r\n")}\r\n\r\n${p.body}`).join("\r\n")}\r\n--${boundary}--\r\n`,
  };
};

/**
 * RFC 2822 message, base64url-encoded as the Gmail API expects. Plain text alone; or, with formatting, plain text and
 * HTML as alternatives of each other; then, with attachments, that body followed by the files.
 */
export function buildRawMessage(m: OutgoingEmail): string {
  const attachments = m.attachments ?? [];
  const headers = [
    m.from ? `From: ${stripBreaks(m.from)}` : null,
    `To: ${stripBreaks(m.to)}`,
    m.bcc ? `Bcc: ${stripBreaks(m.bcc)}` : null,
    `Subject: ${encodeHeader(stripBreaks(m.subject))}`,
    m.inReplyTo ? `In-Reply-To: ${stripBreaks(m.inReplyTo)}` : null,
    m.inReplyTo ? `References: ${stripBreaks(m.inReplyTo)}` : null,
    "MIME-Version: 1.0",
  ].filter((h): h is string => h !== null);

  const plain: Entity = { headers: ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"], body: base64Text(m.body) };
  // Alternatives go from plainest to richest; a client shows the last one it can.
  const text = m.html ? multipart("alternative", [plain, { headers: ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"], body: base64Text(m.html) }]) : plain;
  const files: Entity[] = attachments.map((a) => ({
    headers: [`Content-Type: ${stripBreaks(a.mime)}; name=${fileNameParam(a.filename)}`, `Content-Disposition: attachment; filename=${fileNameParam(a.filename)}`, "Content-Transfer-Encoding: base64"],
    body: wrap76(a.content.toString("base64")),
  }));
  const top = files.length > 0 ? multipart("mixed", [text, ...files]) : text;
  return Buffer.from(`${[...headers, ...top.headers].join("\r\n")}\r\n\r\n${top.body}`, "utf8").toString("base64url");
}

export type SentMessage = { messageId: string; threadId: string };

/** Sends one email from the connected account. The only code path that sends mail. */
export async function sendEmail(m: OutgoingEmail, db: Db = defaultDb()): Promise<SentMessage> {
  const total = (m.attachments ?? []).reduce((n, a) => n + a.content.length, 0);
  if (total > MAX_ATTACHMENT_BYTES) throw new Error("The attachments are larger than 5 MB together. Use smaller files.");
  const { token, account } = await getAccessToken(db);
  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildRawMessage({ from: account.email, ...m }), threadId: m.threadId }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(`Gmail send failed: ${json.error?.message ?? res.statusText}`);
  return { messageId: json.id, threadId: json.threadId ?? json.id };
}

/** A short message to the connected address, to confirm sending works. */
export async function sendTestEmail(db: Db = defaultDb()): Promise<SentMessage> {
  const account = await connectedAccount(db);
  if (!account) throw new Error("Gmail is not connected");
  return sendEmail(
    {
      to: account.email,
      subject: "jobsearchos test email",
      body: "This is a test from jobsearchos. If you can read it, Gmail sending works.",
    },
    db,
  );
}
