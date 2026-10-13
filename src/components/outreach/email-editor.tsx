"use client";

import { Slice } from "@tiptap/pm/model";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { SelectionToolbar } from "@/components/documents/editor/selection-toolbar";
import { SAFE_LINK } from "@/lib/documents/nodes";
import { normalizeEmailDoc, textToEmailDoc, type EmailDoc } from "@/lib/outreach/body";
import { cn } from "@/lib/utils";

const SUBJECT_LINE = /^\s*subject:[ \t]*(.+)\r?\n+([\s\S]*)$/i;

/** Looks and reacts like the app's text fields, so swapping the textarea for the editor changes nothing visually. */
const FIELD =
  "min-h-72 w-full cursor-text rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:not-focus-visible:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 " +
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 " +
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]";

/**
 * The email body editor: one paragraph per line, like Gmail, with bold, italic, underline and links. Selecting text
 * shows the formatting toolbar; its link button opens a field for the address. Web addresses typed or pasted become
 * links on their own. Pasting a whole email that starts with a "Subject:" line into an empty email fills the subject.
 */
export function EmailEditor({
  value,
  onChange,
  onPasteEmail,
  canTakeSubject,
  placeholder,
  className,
}: {
  value: EmailDoc;
  onChange: (doc: EmailDoc) => void;
  onPasteEmail: (subject: string, body: string) => void;
  /** Whether a pasted "Subject:" line may fill the subject (only while nothing is written yet). */
  canTakeSubject: boolean;
  placeholder: string;
  className?: string;
}) {
  // The newest callbacks, for the editor's handlers, which are set up once.
  const handlers = useRef({ onChange, onPasteEmail, canTakeSubject });
  useEffect(() => {
    handlers.current = { onChange, onPasteEmail, canTakeSubject };
  });
  /** The last document this editor reported, to tell its own changes from ones made outside it. */
  const emitted = useRef<EmailDoc>(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        strike: false,
        orderedList: false,
        bulletList: false,
        listItem: false,
        listKeymap: false,
        horizontalRule: false,
        hardBreak: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          isAllowedUri: (url) => SAFE_LINK.test(url),
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: {
      attributes: { class: cn(FIELD, className), role: "textbox", "aria-multiline": "true", "aria-label": "Email body" },
      // Plain text keeps every line, blank ones included (the default would merge them), and its web addresses become links.
      clipboardTextParser: (text, _context, _plain, view) => new Slice(view.state.schema.nodeFromJSON(textToEmailDoc(text)).content, 1, 1),
      handlePaste: (view, event) => {
        const m = SUBJECT_LINE.exec(event.clipboardData?.getData("text/plain") ?? "");
        if (!m || !handlers.current.canTakeSubject || view.state.doc.textContent.trim()) return false;
        handlers.current.onPasteEmail(m[1].trim(), m[2].trim());
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const doc = normalizeEmailDoc(e.getJSON());
      emitted.current = doc;
      handlers.current.onChange(doc);
    },
  });

  // A body set from outside (a pasted email, a sent one reused, the reset after sending) replaces what is shown.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return (
    <>
      <EditorContent editor={editor} />
      {/* Until the editor mounts (it renders in the browser only), an empty field of the same size holds the space. */}
      {!editor && <div aria-hidden className={cn(FIELD, className)} />}
      {editor && <SelectionToolbar editor={editor} />}
    </>
  );
}
