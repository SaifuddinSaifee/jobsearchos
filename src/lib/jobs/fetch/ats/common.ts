import { readBody } from "../fetcher";
import { FetchError, type FetchedPosting, type Fetcher } from "../types";

export async function getJson(fetcher: Fetcher, url: string): Promise<{ body: string; json: unknown }> {
  const res = await fetcher(url, { headers: { accept: "application/json" } });
  const body = await readBody(res);
  try {
    return { body, json: JSON.parse(body) };
  } catch {
    throw new FetchError("empty", "The ATS did not return JSON");
  }
}

export type Obj = Record<string, unknown>;
export const asObj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number | undefined => (typeof v === "number" && isFinite(v) ? v : undefined);

/** Joins non-empty text sections into the JD text the LLM reads. */
export function joinSections(parts: Array<[string, string]>): string {
  return parts
    .filter(([, t]) => t.trim())
    .map(([h, t]) => (h ? `${h}\n${t.trim()}` : t.trim()))
    .join("\n\n");
}

export function requireText(posting: FetchedPosting): FetchedPosting {
  if (posting.text.trim().length < 80) throw new FetchError("empty", "The posting has no readable description");
  return posting;
}
