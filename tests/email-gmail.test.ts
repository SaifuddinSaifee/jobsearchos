import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/email/crypto";
import {
  authUrl,
  buildRawMessage,
  connectWithCode,
  connectedAccount,
  disconnect,
  getAccessToken,
  MAX_ATTACHMENT_BYTES,
  ReconnectRequiredError,
  sendEmail,
} from "@/lib/email/gmail";
import { emailAccounts } from "@/lib/db/schema";
import { resetEnv } from "@/lib/env";
import { resetDb, testDb } from "./helpers";

const db = testDb();
const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY", "APP_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

beforeEach(async () => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.APP_URL = "http://localhost:3000";
  resetEnv();
  await resetDb(db);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnv();
});

afterAll(() => db.$client.end());

async function seedAccount(patch: Partial<typeof emailAccounts.$inferInsert> = {}) {
  const [row] = await db
    .insert(emailAccounts)
    .values({
      provider: "gmail",
      email: "me@example.com",
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      refreshTokenEnc: encrypt("refresh-1"),
      accessTokenEnc: encrypt("access-old"),
      accessTokenExpiresAt: new Date(Date.now() - 1000),
      ...patch,
    })
    .returning();
  return row;
}

describe("authUrl", () => {
  it("asks for offline access, consent and the send and read scopes", () => {
    const url = new URL(authUrl("abc"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/gmail/callback");
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("gmail.send");
    expect(scope).toContain("gmail.readonly");
  });
});

describe("buildRawMessage", () => {
  it("builds a base64url plain-text message with the right headers and body", () => {
    const raw = buildRawMessage({ from: "me@example.com", to: "you@example.com", subject: "hello there", body: "Line one\nLine two" });
    expect(raw).not.toMatch(/[+/=]/);
    const text = decodeRaw(raw);
    expect(text).toContain("From: me@example.com\r\nTo: you@example.com\r\nSubject: hello there\r\n");
    expect(text).toContain("Content-Type: text/plain; charset=UTF-8");
    const body = text.split("\r\n\r\n")[1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Line one\r\nLine two");
  });

  it("cannot be tricked into extra headers through the subject or address", () => {
    const text = decodeRaw(buildRawMessage({ to: "a@b.com\r\nBcc: evil@x.com", subject: "hi\r\nBcc: evil@x.com", body: "x" }));
    expect(text.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
  });

  it("encodes non-ASCII subjects and sets reply headers", () => {
    const text = decodeRaw(buildRawMessage({ to: "a@b.com", subject: "café", body: "x", inReplyTo: "<id@mail>" }));
    expect(text).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(text).toContain("In-Reply-To: <id@mail>");
  });
});

describe("buildRawMessage with attachments", () => {
  const pdf = Buffer.from("%PDF-1.4 fake resume bytes \u0000\u0001\u0002", "latin1");

  it("builds multipart/mixed with the text first and the file as a base64 attachment", () => {
    const text = decodeRaw(buildRawMessage({ from: "me@example.com", to: "you@example.com", subject: "hello", body: "See attached", attachments: [{ filename: "Jane Doe Resume.pdf", mime: "application/pdf", content: pdf }] }));
    const boundary = /Content-Type: multipart\/mixed; boundary="([^"]+)"/.exec(text)?.[1];
    expect(boundary).toBeTruthy();
    const [, ...parts] = text.split(`--${boundary}`).map((p) => p.trim());
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe("--");

    const [bodyHead, bodyData] = parts[0].split("\r\n\r\n");
    expect(bodyHead).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(Buffer.from(bodyData.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("See attached");

    const [fileHead, fileData] = parts[1].split("\r\n\r\n");
    expect(fileHead).toContain('Content-Type: application/pdf; name="Jane Doe Resume.pdf"');
    expect(fileHead).toContain('Content-Disposition: attachment; filename="Jane Doe Resume.pdf"');
    expect(fileHead).toContain("Content-Transfer-Encoding: base64");
    expect(Buffer.from(fileData.replace(/\r\n/g, ""), "base64")).toEqual(pdf);
    expect(fileData.split("\r\n").every((l) => l.length <= 76)).toBe(true);
  });

  it("encodes non-ASCII file names and strips quotes and line breaks from them", () => {
    const text = decodeRaw(buildRawMessage({ to: "a@b.com", subject: "s", body: "x", attachments: [{ filename: 'Rés"umé\r\nBcc: evil@x.com.pdf', mime: "application/pdf", content: pdf }] }));
    expect(text).toMatch(/filename="=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?="/);
    expect(text.split("\r\n\r\n")[0]).not.toMatch(/^Bcc:/m);
    expect(text).not.toMatch(/^Bcc: evil/m);
  });

  it("keeps the plain single-part format when there is nothing to attach", () => {
    expect(decodeRaw(buildRawMessage({ to: "a@b.com", subject: "s", body: "x", attachments: [] }))).not.toContain("multipart");
  });
});

describe("buildRawMessage with formatting", () => {
  const partsOf = (text: string, boundary: string) =>
    text
      .split(`--${boundary}`)
      .slice(1, -1)
      .map((p) => {
        const [head, ...rest] = p.trim().split("\r\n\r\n");
        return { head, body: rest.join("\r\n\r\n") };
      });
  const decode = (b64: string) => Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8");
  const html = '<div dir="ltr"><div>See <a href="https://x.com/p">my <b>proposal</b></a></div></div>';

  it("sends plain text and HTML as alternatives, plain first", () => {
    const text = decodeRaw(buildRawMessage({ to: "a@b.com", subject: "s", body: "See my proposal <https://x.com/p>", html }));
    const boundary = /^Content-Type: multipart\/alternative; boundary="([^"]+)"/m.exec(text)?.[1];
    expect(boundary).toBeTruthy();
    const [plain, rich] = partsOf(text, boundary!);
    expect(plain.head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decode(plain.body)).toBe("See my proposal <https://x.com/p>");
    expect(rich.head).toContain("Content-Type: text/html; charset=UTF-8");
    expect(decode(rich.body)).toBe(html);
  });

  it("puts the alternatives first and the files after them when there are attachments", () => {
    const pdf = Buffer.from("%PDF-1.4 x");
    const text = decodeRaw(buildRawMessage({ to: "a@b.com", subject: "s", body: "plain", html, attachments: [{ filename: "a.pdf", mime: "application/pdf", content: pdf }] }));
    const mixed = /^Content-Type: multipart\/mixed; boundary="([^"]+)"/m.exec(text)?.[1];
    const [body, file] = partsOf(text, mixed!);
    expect(body.head).toMatch(/^Content-Type: multipart\/alternative; boundary="[^"]+"$/);
    const alt = /boundary="([^"]+)"/.exec(body.head)![1];
    expect(partsOf(body.body, alt).map((p) => p.head.split("\r\n")[0])).toEqual(["Content-Type: text/plain; charset=UTF-8", "Content-Type: text/html; charset=UTF-8"]);
    expect(file.head).toContain('filename="a.pdf"');
    expect(Buffer.from(file.body.replace(/\r\n/g, ""), "base64")).toEqual(pdf);
  });
});

describe("sendEmail attachments", () => {
  it("refuses attachments over the size limit before calling Gmail", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await seedAccount();
    await expect(
      sendEmail({ to: "a@b.com", subject: "s", body: "x", attachments: [{ filename: "big.pdf", mime: "application/pdf", content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) }] }, db),
    ).rejects.toThrow(/larger than 5 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("connectWithCode", () => {
  it("stores the account with encrypted tokens and replaces an earlier one", async () => {
    await seedAccount({ email: "old@example.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("oauth2.googleapis.com/token")
          ? json({ access_token: "access-1", refresh_token: "refresh-new", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.send" })
          : json({ email: "new@example.com" }),
      ),
    );
    const row = await connectWithCode("code-1", db);
    expect(row.email).toBe("new@example.com");
    expect(row.refreshTokenEnc).not.toContain("refresh-new");
    expect((await connectedAccount(db))?.email).toBe("new@example.com");
  });

  it("refuses a grant that lacks permission to send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid email" })),
    );
    await expect(connectWithCode("code", db)).rejects.toThrow(/permission to send/i);
    expect(await connectedAccount(db)).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("returns a still-valid token without calling Google", async () => {
    await seedAccount({ accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await getAccessToken(db)).token).toBe("access-old");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and saves the new one", async () => {
    await seedAccount();
    const fetchMock = vi.fn(async () => json({ access_token: "access-new", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getAccessToken(db)).token).toBe("access-new");
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-1");

    fetchMock.mockClear();
    expect((await getAccessToken(db)).token).toBe("access-new");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags the account for reconnecting when Google says invalid_grant", async () => {
    await seedAccount();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_grant" }, 400)));
    await expect(getAccessToken(db)).rejects.toBeInstanceOf(ReconnectRequiredError);
    expect((await connectedAccount(db))?.needsReconnect).toBe(true);
    await expect(getAccessToken(db)).rejects.toBeInstanceOf(ReconnectRequiredError);
  });

  it("says so when Gmail is not connected", async () => {
    await expect(getAccessToken(db)).rejects.toThrow(/not connected/i);
  });
});

describe("sendEmail", () => {
  it("posts the raw message with the bearer token and returns the ids", async () => {
    await seedAccount({ accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000) });
    const fetchMock = vi.fn(async () => json({ id: "m1", threadId: "t1" }));
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendEmail({ to: "you@example.com", subject: "hi", body: "hello" }, db);
    expect(sent).toEqual({ messageId: "m1", threadId: "t1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/users/me/messages/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-old");
    const raw = JSON.parse(init.body as string).raw as string;
    expect(decodeRaw(raw)).toContain("From: me@example.com");
  });

  it("reports Gmail's error message", async () => {
    await seedAccount({ accessTokenExpiresAt: new Date(Date.now() + 10 * 60_000) });
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: "Invalid To header" } }, 400)));
    await expect(sendEmail({ to: "x", subject: "s", body: "b" }, db)).rejects.toThrow(/Invalid To header/);
  });
});

describe("disconnect", () => {
  it("revokes at Google and soft-deletes the account", async () => {
    await seedAccount();
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetchMock);
    await disconnect(db);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("/revoke");
    expect(await connectedAccount(db)).toBeNull();
    expect(await db.select().from(emailAccounts)).toHaveLength(1);
  });

  it("still disconnects when Google is unreachable", async () => {
    await seedAccount();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await disconnect(db);
    expect(await connectedAccount(db)).toBeNull();
  });
});
