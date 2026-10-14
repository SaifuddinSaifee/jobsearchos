"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { focusFrom } from "./navigation";
import { cn } from "@/lib/utils";

type Entry = { pos: number; label: string; level: 0 | 1 };

const LABELS: Record<string, string[]> = {
  role: ["roleTitle", "roleCompany"],
  project: ["projectName"],
  education: ["eduInstitution"],
};

/** The sections of the document, and the entries in them, as a list to jump around by. */
function outlineOf(editor: Editor): Entry[] {
  const out: Entry[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "header") {
      out.push({ pos: offset, label: node.firstChild?.textContent.trim() || "Header", level: 0 });
    } else if (node.type.name === "section") {
      out.push({ pos: offset, label: node.firstChild?.textContent.trim() || "Untitled section", level: 0 });
      node.forEach((child, childOffset) => {
        const parts = LABELS[child.type.name];
        if (!parts) return;
        const text = parts
          .map((name) => child.content.content.find((c) => c.type.name === name)?.textContent.trim())
          .filter(Boolean)
          .join(", ");
        out.push({ pos: offset + 1 + childOffset, label: text || "Untitled", level: 1 });
      });
    }
  });
  return out;
}

export function Outline({ editor }: { editor: Editor }) {
  const entries = useEditorState({ editor, selector: ({ editor: e }) => outlineOf(e) });
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Sections appear here as you write.</p>;

  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.pos}>
          <button
            type="button"
            onClick={() => {
              editor.view.dispatch(focusFrom(editor.state.tr, entry.pos + 1));
              editor.view.focus();
            }}
            className={cn(
              "w-full truncate rounded-md px-2 py-1 text-left text-sm outline-none transition-colors duration-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              entry.level === 0 ? "font-medium" : "pl-5 text-muted-foreground",
            )}
          >
            {entry.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
