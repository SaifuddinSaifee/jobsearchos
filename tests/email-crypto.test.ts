import "dotenv/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { resetEnv } from "@/lib/env";

describe("token encryption", () => {
  const original = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetEnv();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = original;
    resetEnv();
  });

  it("round-trips a value", async () => {
    const { encrypt, decrypt } = await import("@/lib/email/crypto");
    const blob = encrypt("1//refresh-token");
    expect(blob).not.toContain("refresh-token");
    expect(decrypt(blob)).toBe("1//refresh-token");
  });

  it("uses a fresh IV each time", async () => {
    const { encrypt } = await import("@/lib/email/crypto");
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects a tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("@/lib/email/crypto");
    const [iv, tag, data] = encrypt("secret").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("rejects a value encrypted with another key", async () => {
    const { encrypt, decrypt } = await import("@/lib/email/crypto");
    const blob = encrypt("secret");
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    resetEnv();
    expect(() => decrypt(blob)).toThrow();
  });

  it("fails clearly when the key is missing or the wrong size", async () => {
    const { encrypt } = await import("@/lib/email/crypto");
    delete process.env.TOKEN_ENCRYPTION_KEY;
    resetEnv();
    expect(() => encrypt("x")).toThrow(/TOKEN_ENCRYPTION_KEY is not set/);
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    resetEnv();
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });
});
