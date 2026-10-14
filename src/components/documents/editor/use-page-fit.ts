"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PageSettings } from "@/lib/documents/page-settings";
import { A4_PX, MM_TO_PX, resolveMetrics, styleVars } from "@/lib/documents/page-settings";
import { renderBodyHtml } from "@/lib/documents/render/html";

/** How much taller the editor's content is than the printed content, in pixels. */
function ghostOf(editor: Editor, printedPx: number): number {
  const dom = editor.view.dom;
  const first = dom.firstElementChild?.getBoundingClientRect();
  const last = dom.lastElementChild?.getBoundingClientRect();
  if (!first || !last) return 0;
  return Math.max(0, last.bottom - first.top - printedPx);
}

export type SectionHeight = { title: string; px: number };

/**
 * Measures how tall the document is when printed. It lays the same HTML the PDF is made from out in a hidden element
 * as wide as the printable area, so the answer does not depend on what the editor adds around the text (hints in
 * empty fields, handles). `measureWith` lays it out again at other settings, for finding the spacing that fits.
 */
export function usePageFit(editor: Editor | null, settings: PageSettings) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<{ contentPx: number; ready: boolean; sections: SectionHeight[]; ghostPx: number }>({ contentPx: 0, ready: false, sections: [], ghostPx: 0 });

  useEffect(() => {
    const el = document.createElement("div");
    el.className = "rs-page";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;display:flow-root;";
    document.body.appendChild(el);
    host.current = el;
    return () => {
      el.remove();
      host.current = null;
    };
  }, []);

  const layout = useCallback((s: PageSettings): number => {
    const el = host.current;
    if (!el) return 0;
    for (const [k, v] of Object.entries(styleVars(s))) el.style.setProperty(k, v);
    el.style.width = `${A4_PX.width - 2 * resolveMetrics(s).marginMm * MM_TO_PX}px`;
    return el.getBoundingClientRect().height;
  }, []);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });

  /** Rebuilds the hidden copy from the editor's current content and measures it at the current settings. */
  const refresh = useCallback(() => {
    const el = host.current;
    if (!editor || editor.isDestroyed || !el) return;
    el.innerHTML = renderBodyHtml(editor.getJSON());
    const contentPx = layout(settingsRef.current);
    const sections = [...el.querySelectorAll<HTMLElement>(".rs-section")].map((s) => ({ title: s.querySelector(".rs-section-title")?.textContent?.trim() || "Untitled section", px: s.getBoundingClientRect().height }));
    // The editor shows lines the PDF leaves out (an empty field is a line while you are filling it in). The page-end marker
    // is moved down by that much, so it sits where the printed page really ends.
    setState({ contentPx, ready: true, sections, ghostPx: ghostOf(editor, contentPx) });
  }, [editor, layout]);

  // Re-measure shortly after the text changes, and once the fonts have loaded (they change the line breaks).
  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    refresh();
    editor.on("update", soon);
    void document.fonts.ready.then(refresh);
    return () => {
      editor.off("update", soon);
      clearTimeout(timer);
    };
  }, [editor, refresh]);

  // New settings change the height without changing the text.
  useEffect(() => {
    if (!host.current?.firstChild && !state.ready) return;
    const contentPx = layout(settings);
    setState((old) => (Math.abs(old.contentPx - contentPx) < 0.5 ? old : { ...old, contentPx, ghostPx: editor ? ghostOf(editor, contentPx) : 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, layout]);

  return { ...state, measureWith: layout, refresh };
}
