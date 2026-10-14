import { createHash } from "node:crypto";
import type { DocJSON } from "./build";

/** JSON with object keys in a fixed order. Postgres jsonb returns keys in its own order, so plain stringify is not stable. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Server only. A fingerprint of a document's content, to tell whether anything changed. */
export function hashContent(doc: DocJSON, subject = ""): string {
  return createHash("sha256").update(stableStringify([doc, subject])).digest("hex");
}
