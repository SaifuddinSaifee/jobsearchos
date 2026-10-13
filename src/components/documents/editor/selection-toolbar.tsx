"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Check, Italic, Link2, Link2Off, Underline, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { safeHref } from "@/lib/documents/build";
import { cn } from "@/lib/utils";

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={active} title={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn(active && "bg-muted text-foreground")}>
      {children}
    </Button>
  );
}

/** Appears over selected text: bold, italic, underline and a link. Only offers what the field the text is in allows. */
export function SelectionToolbar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const parent = e.state.selection.$from.parent.type;
      const marks = e.schema.marks;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        link: e.isActive("link"),
        href: (e.getAttributes("link").href as string | undefined) ?? "",
        canBold: parent.allowsMarkType(marks.bold),
        canItalic: parent.allowsMarkType(marks.italic),
        canUnderline: parent.allowsMarkType(marks.underline),
        canLink: parent.allowsMarkType(marks.link),
      };
    },
  });

  function applyLink() {
    const href = safeHref(url);
    if (!href) return void toast.error("Enter a web address or an email address");
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinking(false);
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ state }) => {
        const { selection } = state;
        if (selection.empty || !editor.isEditable) return false;
        const parent = selection.$from.parent.type;
        return parent.allowsMarkType(editor.schema.marks.bold) || parent.allowsMarkType(editor.schema.marks.link);
      }}
      className="flex items-center gap-0.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
    >
      {linking ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinking(false)}
            placeholder="example.com or name@example.com"
            aria-label="Link address"
            className="h-7 w-56 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" variant="ghost" size="icon-sm" aria-label="Apply link">
            <Check />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={() => setLinking(false)}>
            <X />
          </Button>
        </form>
      ) : (
        <>
          {s.canBold && (
            <ToolButton label="Bold" active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
              <Bold />
            </ToolButton>
          )}
          {s.canItalic && (
            <ToolButton label="Italic" active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
              <Italic />
            </ToolButton>
          )}
          {s.canUnderline && (
            <ToolButton label="Underline" active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
              <Underline />
            </ToolButton>
          )}
          {s.canLink &&
            (s.link ? (
              <ToolButton label="Remove link" active onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()}>
                <Link2Off />
              </ToolButton>
            ) : (
              <ToolButton
                label="Add link"
                onClick={() => {
                  setUrl("");
                  setLinking(true);
                }}
              >
                <Link2 />
              </ToolButton>
            ))}
        </>
      )}
    </BubbleMenu>
  );
}
