import { Extension, InputRule, wrappingInputRule } from "@tiptap/core";
import { emptySection } from "@/lib/documents/blocks";
import { insertSectionNear } from "./commands";

/**
 * Typing shortcuts. "- " or "* " at the start of a paragraph makes a bullet list. "## " starts a new section after the
 * current one (or in place of an empty paragraph at the top level), with the cursor in its title.
 */
export const DocInputRules = Extension.create({
  name: "docInputRules",
  addInputRules() {
    return [
      wrappingInputRule({ find: /^\s*([-*])\s$/, type: this.editor.schema.nodes.bulletList }),
      new InputRule({
        find: /^##\s$/,
        handler: ({ state, range }) => {
          const { tr, schema } = state;
          const $from = tr.doc.resolve(range.from);
          if ($from.parent.type.name !== "paragraph") return null;
          const container = $from.node($from.depth - 1);
          if (container.type.name !== "doc" && container.type.name !== "section") return null;

          const removed = range.to - range.from;
          tr.delete(range.from, range.to);
          insertSectionNear(tr, $from, removed, schema.nodeFromJSON(emptySection("custom", "")));
          return undefined;
        },
      }),
    ];
  },
});
