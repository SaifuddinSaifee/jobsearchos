import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { liftListItem, sinkListItem, splitListItem } from "@tiptap/pm/schema-list";
import { emptyEducation, emptyParagraph, emptyProject, emptyRole, emptySkillsLine } from "@/lib/documents/blocks";
import { emptyBullets } from "@/lib/documents/build";
import { FIELD_SEQUENCES, FIELD_TYPES } from "@/lib/documents/nodes";
import { cursorIn, currentTextblock, firstTextblockIn, focusFrom, neighbour, type Textblock } from "./navigation";

// How the keys behave on the page. Every key either does something deliberate or does nothing: none of them can leave
// the document in a shape the editor does not allow, and none of them silently joins or deletes a field.

const FIELDS: readonly string[] = FIELD_TYPES;
const SEQUENCES = FIELD_SEQUENCES as Record<string, readonly string[]>;

/** The nesting limit for bullets: a bullet, and bullets under it. */
const MAX_BULLET_LEVELS = 2;

const EMPTY_ENTRY: Partial<Record<string, () => unknown>> = { role: emptyRole, project: emptyProject, education: emptyEducation };

type Where = {
  here: Textblock;
  /** Depth of the text block in the document. */
  depth: number;
  inBullet: boolean;
  isField: boolean;
};

function where(editor: Editor): Where | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const here = currentTextblock(selection.$from);
  if (!here) return null;
  const depth = selection.$from.depth;
  const inBullet = here.node.type.name === "paragraph" && selection.$from.node(depth - 1).type.name === "bullet";
  return { here, depth, inBullet, isField: FIELDS.includes(here.node.type.name) };
}

const bulletType = (editor: Editor) => editor.state.schema.nodes.bullet;
const make = (editor: Editor, json: unknown): PMNode => editor.state.schema.nodeFromJSON(json);

function goto(editor: Editor, target: Textblock | null, at: "start" | "end"): boolean {
  if (target) editor.view.dispatch(cursorIn(editor.state.tr, target, at));
  return true;
}

// ----------------------------------------------------------------- Enter

function enterInField(editor: Editor, w: Where): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  const container = $from.node(w.depth - 1);
  const containerPos = $from.before(w.depth - 1);
  const sequence = SEQUENCES[container.type.name] ?? [];
  const index = sequence.indexOf(w.here.node.type.name);

  // Not the last field: on to the next one.
  if (index >= 0 && index < sequence.length - 1) return goto(editor, neighbour(state, 1), "start");

  switch (container.type.name) {
    case "role":
    case "project":
    case "education": {
      const last = container.lastChild;
      if (last?.type.name === "bulletList") {
        const listPos = containerPos + container.nodeSize - 1 - last.nodeSize;
        return goto(editor, firstTextblockIn(state.doc, listPos), "start");
      }
      // No bullets yet: start the list.
      const at = containerPos + container.nodeSize - 1;
      view.dispatch(focusFrom(state.tr.insert(at, make(editor, emptyBullets())), at));
      return true;
    }
    case "skillsLine": {
      const after = containerPos + container.nodeSize;
      view.dispatch(focusFrom(state.tr.insert(after, make(editor, emptySkillsLine())), after));
      return true;
    }
    case "section": {
      const next = neighbour(state, 1);
      if (next && next.pos < containerPos + container.nodeSize) return goto(editor, next, "start");
      const at = w.here.pos + w.here.node.nodeSize;
      view.dispatch(focusFrom(state.tr.insert(at, make(editor, emptyParagraph())), at));
      return true;
    }
    default:
      return goto(editor, neighbour(state, 1), "start");
  }
}

/** An empty last bullet ends the list: the next entry starts (a new role, a new paragraph...). */
function exitList(editor: Editor, w: Where): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  const d = w.depth;
  const list = $from.node(d - 2);
  const containerDepth = d - 3;
  const container = $from.node(containerDepth);
  const only = list.childCount === 1;
  const tr = state.tr;
  tr.delete(only ? $from.before(d - 2) : $from.before(d - 1), only ? $from.after(d - 2) : $from.after(d - 1));

  const entry = EMPTY_ENTRY[container.type.name];
  const at = entry ? tr.mapping.map($from.after(containerDepth)) : tr.mapping.map($from.after(d - 2), only ? -1 : 1);
  tr.insert(at, make(editor, entry ? entry() : emptyParagraph()));
  view.dispatch(focusFrom(tr, at));
  return true;
}

function enterInBullet(editor: Editor, w: Where): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  const type = bulletType(editor);
  if (w.here.node.content.size > 0) return splitListItem(type)(state, view.dispatch);

  const d = w.depth;
  if ($from.node(d - 3).type.name === "bullet") return liftListItem(type)(state, view.dispatch);
  const isLast = $from.index(d - 2) === $from.node(d - 2).childCount - 1;
  return isLast ? exitList(editor, w) : splitListItem(type)(state, view.dispatch);
}

function enter(editor: Editor): boolean {
  const w = where(editor);
  if (!w) return false;
  if (w.inBullet) return enterInBullet(editor, w);
  if (w.isField) return enterInField(editor, w);
  return false; // a plain paragraph splits as usual
}

// ------------------------------------------------------------- Backspace

/** True when nothing is written in this entry: no text in any field and no bullets with text. */
const isBlank = (node: PMNode) => node.textContent.trim() === "";

function backspace(editor: Editor): boolean {
  const w = where(editor);
  const { state, view } = editor;
  if (!w || state.selection.$from.parentOffset !== 0) return false;
  const { $from } = state.selection;
  const prev = neighbour(state, -1);
  const d = w.depth;
  const isEmpty = w.here.node.content.size === 0;

  if (w.inBullet) {
    const type = bulletType(editor);
    if ($from.node(d - 3).type.name === "bullet") return liftListItem(type)(state, view.dispatch);
    if (!isEmpty || !prev) return goto(editor, prev, "end");
    const only = $from.node(d - 2).childCount === 1;
    const tr = state.tr.delete(only ? $from.before(d - 2) : $from.before(d - 1), only ? $from.after(d - 2) : $from.after(d - 1));
    view.dispatch(cursorIn(tr, prev, "end"));
    return true;
  }

  if (w.isField) {
    // The headline is optional: Backspace in an empty one removes it, and the name closes up with the contact line.
    if (w.here.node.type.name === "headerHeadline" && isEmpty && prev) {
      view.dispatch(cursorIn(state.tr.delete(w.here.pos, w.here.pos + w.here.node.nodeSize), prev, "end"));
      return true;
    }
    const container = $from.node(d - 1);
    const first = SEQUENCES[container.type.name]?.[0] === w.here.node.type.name;
    const removable = first && prev && (container.type.name in EMPTY_ENTRY || container.type.name === "skillsLine" || container.type.name === "section") && isBlank(container);
    if (removable) {
      view.dispatch(cursorIn(state.tr.delete($from.before(d - 1), $from.after(d - 1)), prev, "end"));
      return true;
    }
    return goto(editor, prev, "end");
  }

  // A plain paragraph: joining with a paragraph above is fine (letters); anywhere else, do not merge into something else.
  const parent = $from.node(d - 1);
  const above = $from.index(d - 1) > 0 ? parent.child($from.index(d - 1) - 1) : null;
  if (above?.type.name === "paragraph") return false;
  if (isEmpty && prev) {
    view.dispatch(cursorIn(state.tr.delete($from.before(d), $from.after(d)), prev, "end"));
    return true;
  }
  return goto(editor, prev, "end");
}

/** Delete at the end of a field or bullet moves on to the next one instead of reaching across a boundary. */
function forwardDelete(editor: Editor): boolean {
  const w = where(editor);
  if (!w || !(w.isField || w.inBullet)) return false;
  if (editor.state.selection.$from.parentOffset !== w.here.node.content.size) return false;
  return goto(editor, neighbour(editor.state, 1), "start");
}

// ------------------------------------------------------------------- Tab

const bulletLevels = (editor: Editor) => {
  const { $from } = editor.state.selection;
  let n = 0;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "bulletList") n++;
  return n;
};

function tab(editor: Editor, direction: 1 | -1): boolean {
  const w = where(editor);
  const { state, view } = editor;
  if (!w) return false;
  if (w.inBullet) {
    const type = bulletType(editor);
    if (direction === 1) {
      if (bulletLevels(editor) < MAX_BULLET_LEVELS) sinkListItem(type)(state, view.dispatch);
      return true;
    }
    if (bulletLevels(editor) > 1) return liftListItem(type)(state, view.dispatch);
  }
  const target = neighbour(state, direction);
  return goto(editor, target, direction === 1 ? "start" : "end");
}

/** Sent from the page when the save shortcut is pressed; the editor component listens for it. */
export const SAVE_EVENT = "document-save";

export const DocKeymap = Extension.create({
  name: "docKeymap",
  priority: 1000,
  addKeyboardShortcuts() {
    const editor = this.editor;
    return {
      Enter: () => enter(editor),
      // A line break inside a field or bullet is never wanted: each line is its own field or bullet.
      "Shift-Enter": () => true,
      Backspace: () => backspace(editor),
      Delete: () => forwardDelete(editor),
      Tab: () => tab(editor, 1),
      "Shift-Tab": () => tab(editor, -1),
      "Mod-s": () => {
        editor.view.dom.dispatchEvent(new CustomEvent(SAVE_EVENT, { bubbles: true }));
        return true;
      },
    };
  },
});
