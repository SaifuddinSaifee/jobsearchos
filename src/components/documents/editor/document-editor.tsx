"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { AlertTriangle, Check, CircleAlert, FileCheck2, ListTree, Loader2, RotateCw, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { saveVersionAction, updatePageSettingsAction } from "@/app/(app)/library/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocJSON } from "@/lib/documents/build";
import { fitToPage, linesOver, pagesNeeded } from "@/lib/documents/fit";
import { A4_PX, MM_TO_PX, resolveMetrics, styleVars, type PageSettings } from "@/lib/documents/page-settings";
import { CONTENT_CSS, fontFaceCss, SHEET_CSS } from "@/lib/documents/render/template-css";
import type { DocumentKind } from "@/lib/documents/types";
import { cn } from "@/lib/utils";
import { BlockHandle } from "./block-handle";
import { EDITOR_CSS } from "./editor-css";
import { editorExtensions } from "./extensions";
import { Outline } from "./outline";
import { SAVE_EVENT } from "./keymap";
import { PageSettingsPanel } from "./page-settings-panel";
import { useEditorSession } from "./session";
import { SelectionToolbar } from "./selection-toolbar";
import { SlashCommand } from "./slash";
import { useAutosave, type SaveStatus } from "./use-autosave";
import { usePageFit } from "./use-page-fit";

export type DocumentEditorProps = {
  documentId: string;
  kind: DocumentKind;
  initialContent: DocJSON;
  initialSubject: string;
  initialRevision: number;
  initialSettings: PageSettings;
};

const cssText = (s: PageSettings) =>
  Object.entries(styleVars(s))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

const attributes = (s: PageSettings) => ({
  class: "rs-page rs-sheet rs-editor",
  style: cssText(s),
  role: "textbox",
  "aria-multiline": "true",
  "aria-label": "Document",
  spellcheck: "true",
});

const STATUS: Record<SaveStatus, { text: string; icon: typeof Check; spin?: boolean; tone?: string }> = {
  saved: { text: "Saved", icon: Check },
  dirty: { text: "Unsaved changes", icon: Save },
  saving: { text: "Saving...", icon: Loader2, spin: true },
  error: { text: "Could not save. Trying again...", icon: CircleAlert, tone: "text-destructive" },
  conflict: { text: "Changed elsewhere", icon: AlertTriangle, tone: "text-destructive" },
};

/** The editor: a sheet of A4 you type on. Loaded only on the document page, and only on screens big enough to write on. */
export function DocumentEditor({ documentId, kind, initialContent, initialSubject, initialRevision, initialSettings }: DocumentEditorProps) {
  const router = useRouter();
  const session = useEditorSession();
  const [settings, setSettings] = useState(initialSettings);
  const [subject, setSubject] = useState(initialSubject);
  const [note, setNote] = useState("");
  const [serverPages, setServerPages] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [savingVersion, setSavingVersion] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const subjectRef = useRef(initialSubject);
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const autosave = useAutosave({
    documentId,
    initialRevision,
    onSaved: () => setSavedTick((t) => t + 1),
  });
  const { setReader } = autosave;

  const extensions = useMemo(() => editorExtensions({ extra: [SlashCommand] }), []);
  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: attributes(initialSettings) },
    onUpdate: () => autosave.markDirty(),
  });

  useEffect(() => {
    setReader(() => ({ content: (editor?.getJSON() ?? initialContent) as DocJSON, subject: subjectRef.current }));
  }, [setReader, editor, initialContent]);

  // The save shortcut (Ctrl or Cmd + S) saves right now instead of opening the browser's own dialog.
  const { flush } = autosave;
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const save = () => void flush().then((ok) => (ok ? toast.success("Saved") : toast.error("Could not save")));
    dom.addEventListener(SAVE_EVENT, save);
    return () => dom.removeEventListener(SAVE_EVENT, save);
  }, [editor, flush]);

  // Let the page header's export save first.
  useEffect(() => {
    if (!session) return;
    const flushRef = session.flushRef;
    flushRef.current = autosave.flush;
    return () => {
      flushRef.current = null;
    };
  }, [session, autosave.flush]);

  // ---- settings: shown at once, saved shortly after
  const changeSettings = useCallback(
    (next: PageSettings, why?: string) => {
      setSettings(next);
      if (why) {
        setNote(why);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setNote(""), 6000);
      }
      clearTimeout(settingsTimer.current);
      settingsTimer.current = setTimeout(() => {
        void updatePageSettingsAction(documentId, next).then((res) => !res.ok && toast.error(res.error));
      }, 600);
    },
    [documentId],
  );

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes: attributes(settings) } });
  }, [editor, settings]);

  // ---- how long it is when printed
  const fit = usePageFit(editor, settings);
  const over = settings.fitOnePage && fit.ready ? linesOver(fit.contentPx, settings) : 0;
  const pages = fit.ready ? pagesNeeded(fit.contentPx, settings) : 1;

  // Keep to one page: when it runs over, tighten the spacing (never the words, and never looser).
  useEffect(() => {
    if (!settings.fitOnePage || !fit.ready || over === 0) return;
    const timer = setTimeout(() => {
      const out = fitToPage(settings, fit.measureWith);
      if (out.settings.density !== settings.density) changeSettings(out.settings, "Spacing tightened to keep it on one page.");
    }, 450);
    return () => clearTimeout(timer);
  }, [settings, fit.ready, fit.contentPx, fit.measureWith, over, changeSettings]);

  // Now and then, ask the server how many pages the real PDF comes to; it wins over the estimate made here.
  useEffect(() => {
    if (!settings.fitOnePage || autosave.status !== "saved") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/documents/${documentId}/fit`, { method: "POST" }).catch(() => null);
      if (cancelled || !res?.ok) return;
      const { pages: real } = (await res.json()) as { pages: number };
      if (cancelled) return;
      setServerPages(real);
      if (real > 1 && over === 0 && settings.density < 8) changeSettings({ ...settings, density: settings.density + 1, overrides: {} }, "Spacing tightened a little more so the PDF stays on one page.");
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documentId, settings, savedTick, autosave.status, over, changeSettings]);

  async function saveVersion() {
    setSavingVersion(true);
    const saved = await autosave.flush();
    const res = saved ? await saveVersionAction(documentId, versionNote) : null;
    setSavingVersion(false);
    if (!res) return void toast.error("Could not save your latest changes, so no version was made.");
    if (!res.ok) return void toast.error(res.error);
    setVersionOpen(false);
    setVersionNote("");
    if (res.created) toast.success(`Saved as version ${res.version}`);
    else toast.message(`Nothing has changed since version ${res.version}.`);
    router.refresh();
  }

  const margin = resolveMetrics(settings).marginMm * MM_TO_PX;
  const breakAt = A4_PX.height - margin + fit.ghostPx;
  const st = STATUS[autosave.status];
  const status = settings.fitOnePage ? [note, serverPages && serverPages > 1 && over === 0 ? `The PDF comes to ${serverPages} pages.` : ""].filter(Boolean).join(" ") : "";
  const longest = [...fit.sections].sort((a, b) => b.px - a.px).slice(0, 2).map((s) => s.title);

  if (!editor) return <div className="h-96 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" aria-label="Loading the editor" />;

  return (
    <div className="space-y-3">
      <style dangerouslySetInnerHTML={{ __html: `${fontFaceCss()}\n${CONTENT_CSS}\n${SHEET_CSS}\n${EDITOR_CSS}` }} />

      <div className="sticky top-14 z-20 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/90 px-3 py-2 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className={cn("inline-flex items-center gap-1.5 text-muted-foreground", st.tone)} aria-live="polite">
            <st.icon className={cn("size-3.5", st.spin && "animate-spin motion-reduce:animate-none")} aria-hidden /> {st.text}
          </span>
          {fit.ready && (
            <span
              key={settings.fitOnePage ? (over > 0 ? `over-${over}` : serverPages && serverPages > 1 ? "server" : "fits") : `pages-${pages}`}
              className={cn("inline-flex items-center gap-1.5 animate-in fade-in duration-200 motion-reduce:animate-none", settings.fitOnePage && (over > 0 || (serverPages ?? 1) > 1) ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
            >
              {settings.fitOnePage ? (
                over > 0 ? (
                  <>
                    <AlertTriangle className="size-3.5" aria-hidden /> {over} {over === 1 ? "line" : "lines"} over one page{longest.length > 0 && settings.density === 8 ? `. Longest: ${longest.join(", ")}` : ""}
                  </>
                ) : (serverPages ?? 1) > 1 ? (
                  <>
                    <AlertTriangle className="size-3.5" aria-hidden /> The PDF comes to {serverPages} pages
                  </>
                ) : (
                  <>
                    <FileCheck2 className="size-3.5" aria-hidden /> Fits on one page
                  </>
                )
              ) : (
                `${pages} ${pages === 1 ? "page" : "pages"}`
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {kind === "resume" && (
            <Popover>
              <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                <ListTree aria-hidden /> Outline
              </PopoverTrigger>
              <PopoverContent className="max-h-96 w-72 overflow-y-auto">
                <Outline editor={editor} />
              </PopoverContent>
            </Popover>
          )}
          <PageSettingsPanel settings={settings} onChange={(next) => changeSettings(next)} status={status} />
          <Button variant="outline" size="sm" onClick={() => setVersionOpen(true)}>
            <Save aria-hidden /> Save version
          </Button>
        </div>
      </div>

      {autosave.status === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm">
          <span>This document was changed in another tab or window, so your latest typing was not saved over it.</span>
          <Button size="xs" variant="outline" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden /> Reload the latest
          </Button>
        </div>
      )}

      {kind === "email" && (
        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
          <Label htmlFor="email-subject">Subject</Label>
          <Input
            id="email-subject"
            value={subject}
            maxLength={300}
            onChange={(e) => {
              setSubject(e.target.value);
              subjectRef.current = e.target.value;
              autosave.markDirty();
            }}
          />
        </div>
      )}

      <div className="overflow-x-auto rounded-xl bg-muted/60 p-3 sm:p-6">
        <div ref={wrap} className="relative mx-auto w-fit pl-14">
          <div className="relative w-fit">
            <EditorContent editor={editor} />
            {settings.fitOnePage && (
              <div aria-hidden className="pointer-events-none absolute right-0 left-0 transition-[top] duration-200 motion-reduce:transition-none" style={{ top: breakAt, bottom: over > 0 ? 0 : undefined }}>
                <div className={cn("border-t border-dashed", over > 0 ? "border-amber-500/70 bg-amber-500/5" : "border-foreground/20")} style={over > 0 ? { height: "100%" } : undefined}>
                  <span className="absolute -top-2.5 right-2 rounded bg-background px-1.5 text-[10px] text-muted-foreground">End of page 1</span>
                </div>
              </div>
            )}
          </div>
          <BlockHandle editor={editor} wrap={wrap} />
          <SelectionToolbar editor={editor} />
        </div>
      </div>

      <Dialog open={versionOpen} onOpenChange={(o) => !savingVersion && setVersionOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save a version</DialogTitle>
            <DialogDescription>A version is a checkpoint you can come back to. Your work is already saved as you type; this marks a moment worth keeping.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="version-note">Note (optional)</Label>
            <Input id="version-note" value={versionNote} maxLength={200} placeholder="For example: tuned for the Acme role" onChange={(e) => setVersionNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveVersion()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionOpen(false)} disabled={savingVersion}>
              Cancel
            </Button>
            <Button onClick={() => void saveVersion()} loading={savingVersion}>
              Save version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
