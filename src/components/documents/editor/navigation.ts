import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

// Moving between the text fields of a document. The page is a column of small text blocks (a role's title, dates,
// company...); these helpers find the one before or after the cursor, in reading order.

export type Textblock = { pos: number; node: PMNode };

/** Every text block of the document, in order. `pos` is the position just before the block. */
export function textblocks(doc: PMNode): Textblock[] {
  const out: Textblock[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) out.push({ pos, node });
    return true;
  });
  return out;
}

/** The text block the cursor is in (the one containing `$pos`), or null. */
export function currentTextblock($pos: ResolvedPos): Textblock | null {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.isTextblock) return { pos: $pos.before(d), node };
  }
  return null;
}

export const startOf = (b: Textblock) => b.pos + 1;
export const endOf = (b: Textblock) => b.pos + 1 + b.node.content.size;

/** Puts the cursor at the start (or end) of a text block. */
export function cursorIn(tr: Transaction, b: Textblock, where: "start" | "end"): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, where === "start" ? startOf(b) : endOf(b))).scrollIntoView();
}

export function neighbour(state: EditorState, direction: 1 | -1): Textblock | null {
  const here = currentTextblock(state.selection.$from);
  if (!here) return null;
  const all = textblocks(state.doc);
  const i = all.findIndex((b) => b.pos === here.pos);
  return i < 0 ? null : (all[i + direction] ?? null);
}

/** The first text block inside the node that starts at `pos`. */
export function firstTextblockIn(doc: PMNode, pos: number): Textblock | null {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (node.isTextblock) return { pos, node };
  let found: Textblock | null = null;
  node.descendants((child, offset) => {
    if (found) return false;
    if (child.isTextblock) {
      found = { pos: pos + 1 + offset, node: child };
      return false;
    }
    return true;
  });
  return found;
}

/** Selects the start of the first text block at or after `pos` (used after inserting a block there). */
export function focusFrom(tr: Transaction, pos: number): Transaction {
  const sel = Selection.findFrom(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1, true);
  return sel ? tr.setSelection(sel).scrollIntoView() : tr;
}
