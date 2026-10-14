import type { Extensions } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import { Placeholder } from "@tiptap/extensions";
import { newId } from "@/lib/documents/build";
import { documentExtensions, ID_NODE_TYPES, PLACEHOLDERS } from "@/lib/documents/nodes";
import { DocInputRules } from "./input-rules";
import { DocKeymap } from "./keymap";

/**
 * Everything the editor adds to the document's own definition: hints in empty fields, ids on new blocks, the keys, and
 * the typing shortcuts. The slash menu is added by the component, because it needs the page to show its popup.
 */
export function editorExtensions(options: { extra?: Extensions } = {}): Extensions {
  return [
    ...documentExtensions,
    Placeholder.configure({
      showOnlyCurrent: false,
      includeChildren: true,
      placeholder: ({ node }) => PLACEHOLDERS[node.type.name] ?? "",
    }),
    // A split bullet or a pasted entry copies the id of what it came from; this gives every block its own.
    UniqueID.configure({ types: [...ID_NODE_TYPES], attributeName: "id", generateID: () => newId() }),
    DocKeymap,
    DocInputRules,
    ...(options.extra ?? []),
  ];
}
