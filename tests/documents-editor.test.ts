// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addAfter, blockAt, blockMoves, runBlockAction, slashItems } from "@/components/documents/editor/commands";
import { editorExtensions } from "@/components/documents/editor/extensions";
import type { DocJSON } from "@/lib/documents/build";
import { profileToDoc } from "@/lib/documents/convert/profile-to-doc";
import { textToDoc } from "@/lib/documents/convert/text-to-doc";
import { validateDoc } from "@/lib/documents/schema";
import { emptyProfile } from "@/lib/profile/schema";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function resume() {
  const p = emptyProfile();
  p.contact.name = "Ada Lovelace";
  p.experience = [
    { company: "Acme", title: "Engineer", location: "Remote", start: "2020", end: "", current: true, bullets: ["First bullet", "Second bullet"] },
    { company: "Initech", title: "Developer", location: "", start: "2016", end: "2019", current: false, bullets: [] },
  ];
  p.skills = [{ category: "Languages", items: ["TypeScript"] }];
  return profileToDoc(p);
}

function make(content: DocJSON = resume()) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: editorExtensions(), content });
  editors.push(editor);
  return editor;
}

const types = (editor: Editor) => {
  const out: { type: string; pos: number; text: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) out.push({ type: node.type.name, pos, text: node.textContent });
    return true;
  });
  return out;
};

/** Puts the cursor in the Nth text block with this type and text (or any text), at its start or end. */
function cursor(editor: Editor, type: string, opts: { text?: string; at?: "start" | "end"; nth?: number } = {}) {
  const found = types(editor).filter((b) => b.type === type && (opts.text === undefined || b.text === opts.text))[opts.nth ?? 0];
  if (!found) throw new Error(`no ${type} ${opts.text ?? ""}`);
  const size = editor.state.doc.nodeAt(found.pos)!.content.size;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found.pos + 1 + (opts.at === "start" ? 0 : size))));
}

/** Where the cursor is: the type and text of the text block it is in. */
function where(editor: Editor) {
  const { $from } = editor.state.selection;
  return { type: $from.parent.type.name, text: $from.parent.textContent, offset: $from.parentOffset };
}

function press(editor: Editor, key: string, mods: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) === true;
}

function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  if (!editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, text, () => editor.state.tr))) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}

const valid = (editor: Editor) => {
  const check = validateDoc(editor.getJSON());
  expect(check.ok, check.ok ? "" : check.error).toBe(true);
};

const bullets = (editor: Editor) => types(editor).filter((b) => b.type === "paragraph").map((b) => b.text);

describe("Enter in a field", () => {
  it("moves along the role: title, dates, company, location", () => {
    const e = make();
    cursor(e, "roleTitle", { text: "Engineer" });
    press(e, "Enter");
    expect(where(e)).toMatchObject({ type: "roleDates", offset: 0 });
    press(e, "Enter");
    expect(where(e).type).toBe("roleCompany");
    press(e, "Enter");
    expect(where(e).type).toBe("roleLocation");
    valid(e);
  });

  it("goes into the first bullet from the last field, or starts the list when there is none", () => {
    const e = make();
    cursor(e, "roleLocation", { text: "Remote" });
    press(e, "Enter");
    expect(where(e)).toMatchObject({ type: "paragraph", text: "First bullet", offset: 0 });

    cursor(e, "roleLocation", { nth: 1 });
    expect(bullets(e)).toEqual(["First bullet", "Second bullet"]);
    press(e, "Enter");
    expect(where(e)).toMatchObject({ type: "paragraph", text: "" });
    expect(bullets(e)).toEqual(["First bullet", "Second bullet", ""]);
    valid(e);
  });

  it("starts a new skills line after the last one", () => {
    const e = make();
    cursor(e, "skillsItems", { text: "TypeScript" });
    press(e, "Enter");
    expect(where(e).type).toBe("skillsLabel");
    expect(types(e).filter((b) => b.type === "skillsLabel")).toHaveLength(2);
    valid(e);
  });

  it("goes from a section title to its first entry, or adds a paragraph to an empty section", () => {
    const e = make();
    cursor(e, "sectionTitle", { text: "Experience" });
    press(e, "Enter");
    expect(where(e).type).toBe("roleTitle");

    const empty = make({ type: "doc", content: [{ type: "section", attrs: { kind: "custom", id: "s" }, content: [{ type: "sectionTitle", content: [{ type: "text", text: "Awards" }] }] }] });
    cursor(empty, "sectionTitle");
    press(empty, "Enter");
    expect(where(empty)).toMatchObject({ type: "paragraph", text: "" });
    valid(empty);
  });

  it("never inserts a line break", () => {
    const e = make();
    cursor(e, "roleTitle", { text: "Engineer", at: "start" });
    const before = JSON.stringify(e.getJSON());
    expect(press(e, "Enter", { shiftKey: true })).toBe(true);
    expect(JSON.stringify(e.getJSON())).toBe(before);
  });
});

describe("Enter in a bullet", () => {
  it("splits the bullet at the cursor", () => {
    const e = make();
    cursor(e, "paragraph", { text: "First bullet" });
    const view = e.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 7)));
    press(e, "Enter");
    expect(bullets(e)).toEqual(["First", " bullet", "Second bullet"]);
    expect(where(e)).toMatchObject({ text: " bullet", offset: 0 });
    valid(e);
  });

  it("ends the list on an empty last bullet and starts the next role", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet" });
    press(e, "Enter");
    expect(bullets(e)).toEqual(["First bullet", "Second bullet", ""]);
    press(e, "Enter");
    expect(bullets(e)).toEqual(["First bullet", "Second bullet"]);
    expect(where(e)).toMatchObject({ type: "roleTitle", text: "" });
    expect(types(e).filter((b) => b.type === "roleTitle")).toHaveLength(3);
    valid(e);
  });

  it("indents and outdents with Tab, to two levels and no more", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet" });
    press(e, "Tab");
    const depth = () => {
      const { $from } = e.state.selection;
      let n = 0;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "bulletList") n++;
      return n;
    };
    expect(depth()).toBe(2);
    press(e, "Enter");
    press(e, "Tab");
    expect(depth()).toBe(2);
    valid(e);
    press(e, "Tab", { shiftKey: true });
    expect(depth()).toBe(1);
    valid(e);
  });

  it("outdents an empty nested bullet on Enter", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet" });
    press(e, "Tab");
    press(e, "Enter");
    expect(where(e).text).toBe("");
    press(e, "Enter");
    const { $from } = e.state.selection;
    expect([...Array(4)].map((_, i) => $from.node($from.depth - i - 1).type.name).filter((n) => n === "bulletList")).toHaveLength(1);
    valid(e);
  });
});

describe("Backspace and Delete", () => {
  it("removes a role nobody has written in", () => {
    const e = make();
    cursor(e, "roleLocation", { nth: 1 });
    press(e, "Enter"); // start the empty list
    press(e, "Enter"); // end it: a new empty role
    expect(where(e)).toMatchObject({ type: "roleTitle", text: "" });
    const roles = () => types(e).filter((b) => b.type === "roleTitle").length;
    expect(roles()).toBe(3);
    press(e, "Backspace");
    expect(roles()).toBe(2);
    // The cursor goes back to the end of the entry above.
    expect(where(e)).toMatchObject({ type: "roleLocation" });
    valid(e);
  });

  it("removes an empty headline with Backspace, and the slash menu can add it back", () => {
    const e = make({ type: "doc", content: [{ type: "header", content: [{ type: "headerName", content: [{ type: "text", text: "Ada" }] }, { type: "headerHeadline" }, { type: "headerContact" }] }, { type: "paragraph" }] });
    cursor(e, "headerHeadline");
    press(e, "Backspace");
    expect(types(e).map((b) => b.type)).toEqual(["headerName", "headerContact", "paragraph"]);
    expect(where(e)).toMatchObject({ type: "headerName", text: "Ada", offset: 3 });
    valid(e);

    cursor(e, "paragraph");
    const add = slashItems(e, "").find((i) => i.id === "headline")!;
    expect(add).toBeTruthy();
    add.run(e, { from: e.state.selection.from, to: e.state.selection.from });
    expect(types(e).map((b) => b.type).slice(0, 3)).toEqual(["headerName", "headerHeadline", "headerContact"]);
    expect(where(e).type).toBe("headerHeadline");
    expect(slashItems(e, "").map((i) => i.id)).not.toContain("headline");
    valid(e);
  });

  it("keeps a headline that has text", () => {
    const e = make({ type: "doc", content: [{ type: "header", content: [{ type: "headerName" }, { type: "headerHeadline", content: [{ type: "text", text: "Engineer" }] }, { type: "headerContact" }] }] });
    cursor(e, "headerHeadline", { at: "start" });
    press(e, "Backspace");
    expect(types(e).map((b) => b.type)).toContain("headerHeadline");
  });

  it("never deletes or merges a field that has text; it moves back", () => {
    const e = make();
    cursor(e, "roleDates", { at: "start" });
    const before = e.state.doc.textContent;
    press(e, "Backspace");
    expect(e.state.doc.textContent).toBe(before);
    expect(where(e)).toMatchObject({ type: "roleTitle", text: "Engineer", offset: "Engineer".length });
  });

  it("outdents a nested bullet, and removes an empty single bullet with its list", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet", at: "start" });
    press(e, "Tab");
    press(e, "Backspace");
    valid(e);
    const lists = () => JSON.stringify(e.getJSON()).split('"bulletList"').length - 1;
    expect(lists()).toBe(1);

    cursor(e, "roleLocation", { nth: 1 });
    press(e, "Enter");
    expect(lists()).toBe(2);
    press(e, "Backspace");
    expect(lists()).toBe(1);
    expect(where(e).type).toBe("roleLocation");
    valid(e);
  });

  it("moves back, without merging, from the start of a bullet that has text", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet", at: "start" });
    press(e, "Backspace");
    expect(bullets(e)).toEqual(["First bullet", "Second bullet"]);
    expect(where(e)).toMatchObject({ text: "First bullet", offset: "First bullet".length });
  });

  it("lets paragraphs of a letter join as usual", () => {
    const e = make(textToDoc("One\n\nTwo", { mode: "letter" }));
    cursor(e, "paragraph", { text: "Two", at: "start" });
    press(e, "Backspace");
    expect(bullets(e)).toEqual(["OneTwo"]);
  });

  it("Delete at the end of a field goes on to the next one and deletes nothing", () => {
    const e = make();
    cursor(e, "roleTitle", { text: "Engineer", at: "end" });
    const before = e.state.doc.textContent;
    press(e, "Delete");
    expect(e.state.doc.textContent).toBe(before);
    expect(where(e)).toMatchObject({ type: "roleDates", offset: 0 });
  });
});

describe("Tab between fields", () => {
  it("moves forward and back", () => {
    const e = make();
    cursor(e, "roleTitle", { text: "Engineer" });
    press(e, "Tab");
    expect(where(e).type).toBe("roleDates");
    press(e, "Tab", { shiftKey: true });
    expect(where(e)).toMatchObject({ type: "roleTitle", offset: "Engineer".length });
  });
});

describe("typing shortcuts", () => {
  const withParagraph = () =>
    make({ type: "doc", content: [{ type: "section", attrs: { kind: "custom", id: "s" }, content: [{ type: "sectionTitle", content: [{ type: "text", text: "Notes" }] }, { type: "paragraph" }] }] });

  it('turns "- " at the start of a paragraph into a bullet list', () => {
    const e = withParagraph();
    cursor(e, "paragraph");
    type(e, "-");
    type(e, " ");
    expect(JSON.stringify(e.getJSON())).toContain('"type":"bulletList"');
    expect(where(e).type).toBe("paragraph");
    valid(e);
  });

  it('starts a section with "## ", after the current one, with the cursor in its title', () => {
    const e = withParagraph();
    cursor(e, "paragraph");
    type(e, "#");
    type(e, "#");
    type(e, " ");
    const sections = e.getJSON().content!.filter((n) => n.type === "section");
    expect(sections).toHaveLength(2);
    expect(where(e)).toMatchObject({ type: "sectionTitle", text: "" });
    valid(e);
  });

  it('replaces an empty top-level paragraph with the section on "## "', () => {
    const e = make({ type: "doc", content: [{ type: "paragraph" }] });
    cursor(e, "paragraph");
    type(e, "#");
    type(e, "#");
    type(e, " ");
    expect(e.getJSON().content!.map((n) => n.type)).toEqual(["section"]);
    expect(where(e).type).toBe("sectionTitle");
    valid(e);
  });

  it("does not make a list inside a bullet", () => {
    const e = make();
    cursor(e, "paragraph", { text: "Second bullet", at: "start" });
    const before = JSON.stringify(e.getJSON().content);
    type(e, "-");
    type(e, " ");
    valid(e);
    expect(JSON.stringify(e.getJSON().content).split('"bulletList"').length).toBe(before.split('"bulletList"').length);
  });
});

describe("other keys and ids", () => {
  it("Mod-s saves", () => {
    const onSave = vi.fn();
    const e = make();
    e.view.dom.addEventListener("document-save", onSave);
    cursor(e, "roleTitle", { text: "Engineer" });
    press(e, "s", { ctrlKey: true });
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("gives every new block its own id, even when a split copies one", () => {
    const e = make();
    cursor(e, "paragraph", { text: "First bullet" });
    press(e, "Enter");
    press(e, "Enter");
    cursor(e, "paragraph", { text: "Second bullet" });
    press(e, "Enter");
    const ids: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.attrs.id) ids.push(String(n.attrs.id));
    });
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ------------------------------------------------------------------ slash menu

/** Types a slash in an empty paragraph the way the menu sees it, and returns its range. */
function slash(editor: Editor, query = "") {
  const from = editor.state.selection.from;
  editor.view.dispatch(editor.state.tr.insertText(`/${query}`));
  return { from, to: from + 1 + query.length };
}

const inSection = () =>
  make({ type: "doc", content: [{ type: "section", attrs: { kind: "custom", id: "s" }, content: [{ type: "sectionTitle", content: [{ type: "text", text: "Notes" }] }, { type: "paragraph" }] }] });

describe("slash menu items", () => {
  it("offers entries inside a section, and sections at the top", () => {
    const a = inSection();
    cursor(a, "paragraph");
    expect(slashItems(a, "").map((i) => i.id)).toEqual(["role", "project", "education", "skills", "bullets", "text", "section-custom"]);

    const b = make({ type: "doc", content: [{ type: "paragraph" }] });
    cursor(b, "paragraph");
    const ids = slashItems(b, "").map((i) => i.id);
    expect(ids[0]).toBe("header");
    expect(ids).toEqual(expect.arrayContaining(["section-experience", "section-education", "text", "bullets", "divider"]));

    const withHeader = make({ type: "doc", content: [{ type: "header", content: [{ type: "headerName" }, { type: "headerHeadline" }, { type: "headerContact" }] }, { type: "paragraph" }] });
    cursor(withHeader, "paragraph");
    expect(slashItems(withHeader, "").map((i) => i.id)).not.toContain("header");
  });

  it("narrows by what is typed, by name or keyword", () => {
    const e = inSection();
    cursor(e, "paragraph");
    expect(slashItems(e, "ro").map((i) => i.id)).toContain("role");
    expect(slashItems(e, "school").map((i) => i.id)).toEqual(["education"]);
    expect(slashItems(e, "zzz")).toEqual([]);
  });

  it("puts a role where the slash was, with the cursor in its title", () => {
    const e = inSection();
    cursor(e, "paragraph");
    const range = slash(e, "ro");
    slashItems(e, "ro").find((i) => i.id === "role")!.run(e, range);
    expect(types(e).map((b) => b.type)).toEqual(["sectionTitle", "roleTitle", "roleDates", "roleCompany", "roleLocation"]);
    expect(where(e).type).toBe("roleTitle");
    valid(e);
  });

  it("makes a bullet list, a skills line, and plain text", () => {
    for (const [id, expected] of [["bullets", ["sectionTitle", "paragraph"]], ["skills", ["sectionTitle", "skillsLabel", "skillsItems"]], ["text", ["sectionTitle", "paragraph"]]] as const) {
      const e = inSection();
      cursor(e, "paragraph");
      slashItems(e, "").find((i) => i.id === id)!.run(e, slash(e));
      expect(types(e).map((b) => b.type)).toEqual(expected);
      valid(e);
    }
    const t = inSection();
    cursor(t, "paragraph");
    slashItems(t, "").find((i) => i.id === "text")!.run(t, slash(t));
    expect(where(t)).toMatchObject({ type: "paragraph", text: "" });
  });

  it("starts a new section after this one from inside a section", () => {
    const e = inSection();
    cursor(e, "paragraph");
    slashItems(e, "").find((i) => i.id === "section-custom")!.run(e, slash(e));
    const sections = e.getJSON().content!.filter((n) => n.type === "section");
    expect(sections).toHaveLength(2);
    expect(sections[0].content!.map((n) => n.type)).toEqual(["sectionTitle"]);
    expect(where(e)).toMatchObject({ type: "sectionTitle", text: "" });
    valid(e);
  });

  it("puts a header at the very top, and a section in place of the empty paragraph", () => {
    const e = make({ type: "doc", content: [{ type: "paragraph" }] });
    cursor(e, "paragraph");
    slashItems(e, "").find((i) => i.id === "header")!.run(e, slash(e));
    expect(e.getJSON().content!.map((n) => n.type)).toEqual(["header"]);
    expect(where(e).type).toBe("headerName");
    valid(e);

    const f = make({ type: "doc", content: [{ type: "paragraph" }] });
    cursor(f, "paragraph");
    slashItems(f, "").find((i) => i.id === "section-experience")!.run(f, slash(f));
    expect(f.getJSON().content!.map((n) => n.type)).toEqual(["section"]);
    expect(types(f).map((b) => b.type)).toEqual(["sectionTitle", "roleTitle", "roleDates", "roleCompany", "roleLocation"]);
    expect(types(f)[0].text).toBe("Experience");
    valid(f);
  });
});

// ------------------------------------------------------------------ block menu

const blockPos = (editor: Editor, type: string, nth = 0) => {
  const found: number[] = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === type) found.push(pos);
    return true;
  });
  return found[nth];
};

describe("block actions", () => {
  it("finds the block the pointer is over: a bullet inside a role, the role itself, or the whole section", () => {
    const e = make();
    const bulletText = types(e).find((b) => b.text === "First bullet")!;
    expect(blockAt(e, bulletText.pos + 2)?.node.type.name).toBe("bullet");
    const title = types(e).find((b) => b.type === "roleTitle")!;
    expect(blockAt(e, title.pos + 2)?.node.type.name).toBe("role");
    const sectionTitle = types(e).find((b) => b.type === "sectionTitle")!;
    expect(blockAt(e, sectionTitle.pos + 2)?.node.type.name).toBe("section");
  });

  it("duplicates a role with fresh ids", () => {
    const e = make();
    expect(runBlockAction(e, blockPos(e, "role"), "duplicate")).toBe(true);
    expect(types(e).filter((b) => b.type === "roleTitle").map((b) => b.text)).toEqual(["Engineer", "Engineer", "Developer"]);
    const ids: string[] = [];
    e.state.doc.descendants((n) => {
      if (n.attrs.id) ids.push(String(n.attrs.id));
    });
    expect(new Set(ids).size).toBe(ids.length);
    valid(e);
  });

  it("deletes a role, and a lone bullet takes its list with it", () => {
    const e = make();
    runBlockAction(e, blockPos(e, "role", 1), "delete");
    expect(types(e).filter((b) => b.type === "roleTitle")).toHaveLength(1);

    runBlockAction(e, blockPos(e, "bullet", 1), "delete");
    expect(bullets(e)).toEqual(["First bullet"]);
    runBlockAction(e, blockPos(e, "bullet", 0), "delete");
    expect(JSON.stringify(e.getJSON())).not.toContain('"bulletList"');
    valid(e);
  });

  it("moves blocks up and down among their neighbours, and says when it cannot", () => {
    const e = make();
    expect(blockMoves(e, blockPos(e, "role", 0))).toEqual({ up: false, down: true });
    expect(blockMoves(e, blockPos(e, "role", 1))).toEqual({ up: true, down: false });
    runBlockAction(e, blockPos(e, "role", 0), "down");
    expect(types(e).filter((b) => b.type === "roleTitle").map((b) => b.text)).toEqual(["Developer", "Engineer"]);
    runBlockAction(e, blockPos(e, "bullet", 1), "up");
    expect(bullets(e)).toEqual(["Second bullet", "First bullet"]);
    expect(runBlockAction(e, blockPos(e, "role", 0), "up")).toBe(false);
    valid(e);
  });

  it("will not move a section above the header", () => {
    const e = make();
    expect(runBlockAction(e, blockPos(e, "section", 0), "up")).toBe(false);
    expect(e.getJSON().content![0].type).toBe("header");
  });

  it("adds a bullet after a bullet, and a paragraph with the slash menu open after anything else", () => {
    const e = make();
    expect(addAfter(e, blockPos(e, "bullet", 0))).toBe(true);
    expect(bullets(e)).toEqual(["First bullet", "", "Second bullet"]);
    expect(where(e).type).toBe("paragraph");

    expect(addAfter(e, blockPos(e, "role", 0))).toBe(true);
    expect(where(e)).toMatchObject({ type: "paragraph", text: "/" });
    valid(e);
  });
});

describe("insertBullet", () => {
  /** The bullet texts of every role, in order. */
  const bulletsOf = (editor: Editor, roleIndex: number) => {
    const roles: string[][] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "role") return true;
      const out: string[] = [];
      node.descendants((n) => {
        if (n.type.name === "bullet") out.push(n.firstChild?.textContent ?? "");
        return true;
      });
      roles.push(out);
      return false;
    });
    return roles[roleIndex];
  };
  const rolePos = (editor: Editor, index: number) => {
    const found: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "role") found.push(pos);
      return true;
    });
    return found[index];
  };

  it("adds a bullet after the last one of a role", async () => {
    const { insertBullet } = await import("@/components/documents/editor/commands");
    const editor = make();
    expect(insertBullet(editor, rolePos(editor, 0), "Third bullet")).toBe(true);
    expect(bulletsOf(editor, 0)).toEqual(["First bullet", "Second bullet", "Third bullet"]);
    expect(validateDoc(editor.getJSON()).ok).toBe(true);
  });

  it("starts the list for a role that has none, and gives the bullet an id", async () => {
    const { insertBullet } = await import("@/components/documents/editor/commands");
    const editor = make();
    expect(insertBullet(editor, rolePos(editor, 1), "  Only   bullet  ")).toBe(true);
    expect(bulletsOf(editor, 1)).toEqual(["Only bullet"]);
    expect(bulletsOf(editor, 0)).toEqual(["First bullet", "Second bullet"]);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain("Only bullet");
    expect(validateDoc(editor.getJSON()).ok).toBe(true);
  });

  it("can be undone in one step", async () => {
    const { insertBullet } = await import("@/components/documents/editor/commands");
    const editor = make();
    insertBullet(editor, rolePos(editor, 0), "Third bullet");
    editor.commands.undo();
    expect(bulletsOf(editor, 0)).toEqual(["First bullet", "Second bullet"]);
  });

  it("does nothing for a position that is not a role, or for empty text", async () => {
    const { insertBullet } = await import("@/components/documents/editor/commands");
    const editor = make();
    const before = JSON.stringify(editor.getJSON());
    expect(insertBullet(editor, 0, "x")).toBe(false);
    expect(insertBullet(editor, rolePos(editor, 0), "   ")).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  });
});
