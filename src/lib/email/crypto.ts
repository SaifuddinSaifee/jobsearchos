import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  const raw = env().TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and add it to .env.");
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (`openssl rand -base64 32`).");
  }
  return bytes;
}

/** Returns `iv.tag.ciphertext`, each part base64. */
export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

/** Throws if the blob was changed or was encrypted with a different key. */
export function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Malformed encrypted value");
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
