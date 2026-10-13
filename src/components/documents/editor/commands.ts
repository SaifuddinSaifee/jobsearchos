import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Briefcase, FolderKanban, GraduationCap, Heading, List, Minus, Type, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { emptyEducation, emptyHeader, emptyParagraph, emptyProject, emptyRole, emptySection, emptySkillsLine, SECTION_TITLES } from "@/lib/documents/blocks";
import { emptyBullets, type DocJSON } from "@/lib/documents/build";
import type { SectionKind } from "@/lib/documents/nodes";
import { focusFrom } from "./navigation";

// What the slash menu and the block menu can do to the page. Each command makes one transaction and checks nothing
// else will break: a command that would leave the document in a shape the editor does not allow does nothing.

export type Range = { from: number; to: number };

/** Dispatches only if the result is a document the editor accepts. */
function apply(editor: Editor, tr: Transaction): boolean {
  try {
    tr.doc.check();
  } catch {
    return false;
  }
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

const make = (editor: Editor, json: DocJSON): PMNode => editor.state.schema.nodeFromJSON(json);

/**
 * Puts a new section near the cursor: in place of an emptied top-level paragraph, otherwise after the paragraph, or
 * after the section the paragraph is in. `removed` is how much text was just deleted from this paragraph. The cursor
 * ends in the new section's title. Used by the "## " shortcut and the slash menu.
 */
export function insertSectionNear(tr: Transaction, $from: ResolvedPos, removed: number, section: PMNode): Transaction {
  const container = $from.node($from.depth - 1);
  const paraStart = $from.before();
  const paraEnd = $from.after() - removed;
  const emptied = $from.parent.content.size - removed === 0;
  let titleAt: number;
  if (container.type.name === "doc" && emptied) {
    tr.replaceWith(paraStart, paraEnd, section);
    titleAt = paraStart + 2;
  } else {
    const insertAt = (container.type.name === "section" ? $from.after($from.depth - 1) : $from.after()) - removed;
    tr.insert(insertAt, section);
    titleAt = insertAt + 2;
    if (emptied) {
      tr.delete(paraStart, paraEnd);
      titleAt -= paraEnd - paraStart;
    }
  }
  return tr.setSelection(TextSelection.create(tr.doc, titleAt)).scrollIntoView();
}

/** Replaces the (otherwise empty) paragraph the slash was typed in with a block that belongs in the same place. */
function replaceParagraph(editor: Editor, range: Range, json: DocJSON): boolean {
  const { state } = editor;
  const $from = state.doc.resolve(range.from);
  const removed = range.to - range.from;
  const start = $from.before();
  const end = $from.after() - removed;
  const emptied = $from.parent.content.size - removed === 0;
  const tr = state.tr.delete(range.from, range.to);
  if (emptied) tr.replaceWith(start, end, make(editor, json));
  else tr.insert(end, make(editor, json));
  return apply(editor, focusFrom(tr, emptied ? start : end));
}

const dropSlash = (editor: Editor, range: Range) => apply(editor, editor.state.tr.delete(range.from, range.to));

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  keywords: string;
  run: (editor: Editor, range: Range) => void;
};

const sectionItem = (kind: SectionKind, hint: string): SlashItem => ({
  id: `section-${kind}`,
  label: kind === "custom" ? "Section" : `${SECTION_TITLES[kind]} section`,
  hint,
  icon: Heading,
  keywords: `section heading ${kind} ${SECTION_TITLES[kind]}`.toLowerCase(),
  run: (editor, range) => {
    const { state } = editor;
    const $from = state.doc.resolve(range.from);
    const tr = state.tr.delete(range.from, range.to);
    apply(editor, insertSectionNear(tr, $from, range.to - range.from, make(editor, emptySection(kind))));
  },
});

/** Blocks that can go inside a section. */
const IN_SECTION: SlashItem[] = [
  { id: "role", label: "Role", hint: "A job: title, company, dates", icon: Briefcase, keywords: "role job experience position work", run: (e, r) => void replaceParagraph(e, r, emptyRole()) },
  { id: "project", label: "Project", hint: "Something you built", icon: FolderKanban, keywords: "project side built", run: (e, r) => void replaceParagraph(e, r, emptyProject()) },
  { id: "education", label: "Education", hint: "School, degree, dates", icon: GraduationCap, keywords: "education school degree university", run: (e, r) => void replaceParagraph(e, r, emptyEducation()) },
  { id: "skills", label: "Skills line", hint: "A label and a list", icon: Wrench, keywords: "skills line languages tools", run: (e, r) => void replaceParagraph(e, r, emptySkillsLine()) },
  { id: "bullets", label: "Bullet list", hint: "A list of points", icon: List, keywords: "bullet list points", run: (e, r) => void replaceParagraph(e, r, emptyBullets()) },
  { id: "text", label: "Text", hint: "A plain paragraph", icon: Type, keywords: "text paragraph plain", run: (e, r) => void dropSlash(e, r) },
  sectionItem("custom", "A new section after this one"),
];

const AT_TOP: SlashItem[] = [
  sectionItem("experience", "Roles and what you did"),
  sectionItem("education", "Schools and degrees"),
  sectionItem("projects", "Things you built"),
  sectionItem("skills", "Skills and tools"),
  sectionItem("summary", "A short introduction"),
  sectionItem("custom", "Any other heading"),
  { id: "text", label: "Text", hint: "A plain paragraph", icon: Type, keywords: "text paragraph plain", run: (e, r) => void dropSlash(e, r) },
  { id: "bullets", label: "Bullet list", hint: "A list of points", icon: List, keywords: "bullet list points", run: (e, r) => void replaceParagraph(e, r, emptyBullets()) },
  { id: "divider", label: "Divider", hint: "A line across the page", icon: Minus, keywords: "divider line rule separator", run: (e, r) => void replaceParagraph(e, r, { type: "divider" }) },
];

const HEADER_ITEM: SlashItem = {
  id: "header",
  label: "Header",
  hint: "Your name and contact details",
  icon: UserRound,
  keywords: "header name contact top",
  run: (editor, range) => {
    const { state } = editor;
    const $from = state.doc.resolve(range.from);
    const emptied = $from.parent.content.size - (range.to - range.from) === 0;
    const tr = state.tr.delete(range.from, range.to);
    if (emptied) tr.delete($from.before(), $from.after() - (range.to - range.from));
    tr.insert(0, make(editor, emptyHeader()));
    apply(editor, focusFrom(tr, 0));
  },
};

/** Adds the optional headline under the name. Only offered when the header has none. */
const HEADLINE_ITEM: SlashItem = {
  id: "headline",
  label: "Headline",
  hint: "A line under your name",
  icon: Heading,
  keywords: "headline title tagline subtitle name",
  run: (editor, range) => {
    const { state } = editor;
    const header = state.doc.firstChild;
    if (header?.type.name !== "header" || !header.firstChild) return;
    const $from = state.doc.resolve(range.from);
    const emptied = $from.parent.content.size - (range.to - range.from) === 0;
    const tr = state.tr.delete(range.from, range.to);
    if (emptied) tr.delete($from.before(), $from.after() - (range.to - range.from));
    const at = 1 + header.firstChild.nodeSize;
    tr.insert(at, make(editor, { type: "headerHeadline" }));
    tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView();
    apply(editor, tr);
  },
};

/** The blocks to offer where the cursor is, narrowed by what has been typed after the slash. */
export function slashItems(editor: Editor, query: string): SlashItem[] {
  const { $from } = editor.state.selection;
  const inSection = $from.node($from.depth - 1).type.name === "section";
  const hasHeader = editor.state.doc.firstChild?.type.name === "header";
  const header = editor.state.doc.firstChild;
  const canAddHeadline = hasHeader && header?.child(1)?.type.name !== "headerHeadline";
  const headline = canAddHeadline ? [HEADLINE_ITEM] : [];
  const all = inSection ? [...IN_SECTION, ...headline] : hasHeader ? [...headline, ...AT_TOP] : [HEADER_ITEM, ...AT_TOP];
  const q = query.trim().toLowerCase();
  return q ? all.filter((i) => i.label.toLowerCase().includes(q) || i.keywords.includes(q)) : all;
}

// ----------------------------------------------------------- the block menu

/** The kinds of block that can be dragged and moved as a unit. */
const BLOCKS = new Set(["header", "section", "role", "project", "education", "skillsLine", "bulletList", "bullet", "divider"]);

/** Removes ids so a copy of a block gets fresh ones. */
function withoutIds(json: DocJSON): DocJSON {
  const { attrs, ...rest } = json;
  const clean = attrs ? Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "id")) : undefined;
  return { ...rest, ...(clean && Object.keys(clean).length ? { attrs: clean } : {}), ...(json.content ? { content: json.content.map(withoutIds) } : {}) };
}

/** The block a position belongs to, for dragging and for the block menu: the closest ancestor that moves as a unit. */
export function blockAt(editor: Editor, pos: number): { pos: number; node: PMNode; depth: number } | null {
  const $pos = editor.state.doc.resolve(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const parent = $pos.node(d - 1).type.name;
    const loose = node.type.name === "paragraph" && (parent === "doc" || parent === "section");
    if (BLOCKS.has(node.type.name) || loose) return { pos: $pos.before(d), node, depth: d };
  }
  return null;
}

export type BlockAction = "duplicate" | "delete" | "up" | "down";

/** Whether swapping two neighbouring children of `parent` leaves content the editor allows (a role cannot pass its section title). */
function canSwap(parent: PMNode, i: number, j: number): boolean {
  if (j < 0 || j >= parent.childCount) return false;
  const kids: PMNode[] = [];
  parent.forEach((child) => kids.push(child));
  [kids[i], kids[j]] = [kids[j], kids[i]];
  return parent.type.validContent(Fragment.fromArray(kids));
}

/** Whether this block can move up or down among its neighbours. */
export function blockMoves(editor: Editor, pos: number): { up: boolean; down: boolean } {
  const $pos = editor.state.doc.resolve(pos);
  const i = $pos.index();
  return { up: canSwap($pos.parent, i, i - 1), down: canSwap($pos.parent, i, i + 1) };
}

export function runBlockAction(editor: Editor, pos: number, action: BlockAction): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const end = pos + node.nodeSize;
  const $pos = state.doc.resolve(pos);

  switch (action) {
    case "duplicate": {
      const copy = make(editor, withoutIds(node.toJSON() as DocJSON));
      return apply(editor, focusFrom(state.tr.insert(end, copy), end));
    }
    case "delete": {
      // A list with nothing left in it goes too.
      const list = $pos.parent;
      const only = node.type.name === "bullet" && list.childCount === 1;
      const tr = only ? state.tr.delete($pos.before(), $pos.after()) : state.tr.delete(pos, end);
      const at = Math.min(only ? $pos.before() : pos, tr.doc.content.size);
      return apply(editor, tr.setSelection(TextSelection.near(tr.doc.resolve(at), -1)));
    }
    case "up":
    case "down": {
      const i = $pos.index();
      const j = action === "up" ? i - 1 : i + 1;
      if (!canSwap($pos.parent, i, j)) return false;
      const other = $pos.parent.child(j);
      const to = action === "up" ? pos - other.nodeSize : pos + other.nodeSize;
      const tr = state.tr.delete(pos, end).insert(to, node);
      return apply(editor, tr.setSelection(NodeSelection.create(tr.doc, to)));
    }
  }
}

/** Adds an empty block after this one: a new bullet after a bullet, otherwise a paragraph (and the slash menu opens on it). */
export function addAfter(editor: Editor, pos: number): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(pos);
  if (!node) return false;
  const end = pos + node.nodeSize;
  const isBullet = node.type.name === "bullet";
  const tr = state.tr.insert(end, make(editor, isBullet ? { type: "bullet", content: [emptyParagraph()] } : emptyParagraph()));
  if (!apply(editor, focusFrom(tr, end))) return false;
  if (!isBullet) editor.view.dispatch(editor.state.tr.insertText("/"));
  return true;
}

/** Starts dragging a block: selects it and hands it to the page's own drag and drop as something to move. */
export function beginBlockDrag(editor: Editor, pos: number, data: DataTransfer): void {
  const selection = NodeSelection.create(editor.state.doc, pos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  editor.view.dragging = { slice: selection.content(), move: true };
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  if (dom) data.setDragImage(dom, 0, 0);
  data.effectAllowed = "copyMove";
  data.setData("text/plain", "");
}

export function endBlockDrag(editor: Editor): void {
  editor.view.dragging = null;
}
