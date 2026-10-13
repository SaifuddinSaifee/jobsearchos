import { FIELD_SEQUENCES, ID_NODE_TYPES, OPTIONAL_FIELDS, SECTION_KINDS } from "../nodes";
import { newId, type DocJSON, type IdGen } from "../build";

const SEQUENCES = FIELD_SEQUENCES as Record<string, readonly string[]>;
const NEEDS_ID = new Set<string>(ID_NODE_TYPES);

/**
 * Makes a document safe to load: every container has all of its fields in order (missing ones are added empty),
 * every node that should have an id has one, and section kinds are valid. Content is never changed or dropped.
 * Returns a new document; the input is left alone.
 */
export function normalizeDoc(doc: DocJSON, id: IdGen = newId): DocJSON {
  const seen = new Set<string>();

  const walk = (n: DocJSON): DocJSON => {
    const type = n.type ?? "";
    let content = n.content?.map(walk);

    const required = SEQUENCES[type];
    if (required && content) {
      const used = new Set<number>();
      const fields = required.flatMap((name) => {
        const at = content!.findIndex((c, k) => c.type === name && !used.has(k));
        if (at >= 0) {
          used.add(at);
          return [content![at]];
        }
        return OPTIONAL_FIELDS.has(name) ? [] : [{ type: name } as DocJSON];
      });
      content = [...fields, ...content.filter((_, k) => !used.has(k))];
    } else if (required && !content) {
      content = required.filter((name) => !OPTIONAL_FIELDS.has(name)).map((name) => ({ type: name }) as DocJSON);
    }

    let attrs = n.attrs;
    if (NEEDS_ID.has(type)) {
      let value = typeof attrs?.id === "string" && attrs.id ? attrs.id : "";
      if (!value || seen.has(value)) value = id();
      seen.add(value);
      attrs = { ...attrs, id: value };
    }
    if (type === "section") {
      const kind = String(attrs?.kind ?? "");
      attrs = { ...attrs, kind: (SECTION_KINDS as readonly string[]).includes(kind) ? kind : "custom" };
    }

    return { ...n, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) };
  };

  return walk(doc);
}
