"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";

export type RoleUnderCursor = {
  /** Position of the role block, for inserting into it. */
  pos: number;
  id: string;
  title: string;
  company: string;
  dates: string;
  /** The text of the bullets it has now. */
  bullets: string[];
};

const field = (role: { forEach: (f: (n: { type: { name: string }; textContent: string }) => void) => void }, name: string) => {
  let out = "";
  role.forEach((n) => {
    if (n.type.name === name) out = n.textContent.trim();
  });
  return out;
};

/** The role the cursor is in, or null when it is elsewhere. Re-renders only when something about that role changes. */
export function useRoleUnderCursor(editor: Editor): RoleUnderCursor | null {
  return useEditorState({
    editor,
    selector: ({ editor: e }): RoleUnderCursor | null => {
      const { $from } = e.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name !== "role") continue;
        const bullets: string[] = [];
        node.descendants((n) => {
          if (n.type.name === "bullet") bullets.push(n.firstChild?.textContent.trim() ?? "");
          return true;
        });
        return {
          pos: $from.before(d),
          id: String(node.attrs.id ?? ""),
          title: field(node, "roleTitle"),
          company: field(node, "roleCompany"),
          dates: field(node, "roleDates"),
          bullets,
        };
      }
      return null;
    },
  });
}
