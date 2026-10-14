import type { DocJSON } from "../build";
import { children } from "../read";

/**
 * When a resume read from plain text is replaced by a structured one, the model's version has no place for sections
 * a profile cannot hold (Publications, Languages, Volunteering...). Those sections are carried over from the original
 * and added at the end, so structuring never loses text.
 */
export function keepCustomSections(structured: DocJSON, original: DocJSON): DocJSON {
  const custom = children(original).filter((n) => n.type === "section" && n.attrs?.kind === "custom");
  if (custom.length === 0) return structured;
  return { ...structured, content: [...children(structured), ...custom] };
}
