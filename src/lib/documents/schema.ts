import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { z } from "zod";
import type { DocJSON } from "./build";
import { documentExtensions, MARK_TYPES, NODE_TYPES, SAFE_LINK } from "./nodes";

/** Largest document accepted, as JSON text. A resume is a few KB; this only stops abuse and runaway pastes. */
export const MAX_DOC_BYTES = 512_000;
const MAX_DEPTH = 16;

const MarkSchema = z.object({
  type: z.enum(MARK_TYPES),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

type NodeShape = {
  type: (typeof NODE_TYPES)[number];
  attrs?: Record<string, unknown>;
  content?: NodeShape[];
  text?: string;
  marks?: z.infer<typeof MarkSchema>[];
};

const NodeSchema: z.ZodType<NodeShape> = z.lazy(() =>
  z.object({
    type: z.enum(NODE_TYPES),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(NodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(MarkSchema).optional(),
  }),
);

function depthOf(n: NodeShape): number {
  return 1 + Math.max(0, ...(n.content ?? []).map(depthOf));
}

function linksAreSafe(n: NodeShape): boolean {
  const own = (n.marks ?? []).every((m) => m.type !== "link" || (typeof m.attrs?.href === "string" && SAFE_LINK.test(m.attrs.href)));
  return own && (n.content ?? []).every(linksAreSafe);
}

/**
 * The shape and safety of a document: known node and mark types only, links to http, https or mailto only, bounded
 * size and depth. It does not check that blocks are in a legal order; `validateDoc` does that too.
 */
export const DocContentSchema = z
  .object({ type: z.literal("doc"), content: z.array(NodeSchema).optional() })
  .superRefine((doc, ctx) => {
    if (JSON.stringify(doc).length > MAX_DOC_BYTES) ctx.addIssue({ code: "custom", message: "Document is too large" });
    if (depthOf(doc as NodeShape) > MAX_DEPTH) ctx.addIssue({ code: "custom", message: "Document is nested too deeply" });
    if (!linksAreSafe(doc as NodeShape)) ctx.addIssue({ code: "custom", message: "Links must start with http, https or mailto" });
  });

let schema: ReturnType<typeof getSchema> | undefined;
const pmSchema = () => (schema ??= getSchema(documentExtensions));

export type DocCheck = { ok: true; doc: DocJSON } | { ok: false; error: string };

/** Full check: the shape above, then the editor's own rules about which blocks may contain which. */
export function validateDoc(raw: unknown): DocCheck {
  const shape = DocContentSchema.safeParse(raw);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid document" };
  try {
    PMNode.fromJSON(pmSchema(), shape.data).check();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid document structure" };
  }
  return { ok: true, doc: shape.data as DocJSON };
}

export function assertValidDoc(raw: unknown): DocJSON {
  const r = validateDoc(raw);
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

export const emptyDoc = (): DocJSON => ({ type: "doc", content: [{ type: "paragraph" }] });
