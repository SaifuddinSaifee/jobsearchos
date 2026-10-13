"use client";

import { createContext, useContext, type MutableRefObject } from "react";

/**
 * What the document page and the editor inside it share: the editor registers a way to save right now, so an export
 * made from the page header always includes the latest typing.
 */
export type EditorSession = {
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>;
};

const Ctx = createContext<EditorSession | null>(null);

export const EditorSessionProvider = Ctx.Provider;
export const useEditorSession = () => useContext(Ctx);
