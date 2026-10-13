import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type { CSSProperties } from "react";
import type { DocJSON } from "@/lib/documents/build";
import { documentExtensions } from "@/lib/documents/nodes";
import { styleVars, type PageSettings } from "@/lib/documents/page-settings";
import { CONTENT_CSS, fontFaceCss, SHEET_CSS } from "@/lib/documents/render/template-css";
import { FitWidth } from "./fit-width";

/**
 * A document on a sheet of A4, read only. It is a server component and renders the same markup and CSS the PDF is
 * made from, so what shows here is the layout that gets exported. The styles are constants of ours, never user text.
 */
export function DocumentPage({ content, settings }: { content: DocJSON; settings: PageSettings }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3 sm:p-6">
      <style dangerouslySetInnerHTML={{ __html: `${fontFaceCss()}\n${CONTENT_CSS}\n${SHEET_CSS}` }} />
      <FitWidth>
        <div className="rs-page rs-sheet" style={styleVars(settings) as CSSProperties}>
          {renderToReactElement({ content, extensions: documentExtensions })}
        </div>
      </FitWidth>
    </div>
  );
}
