"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { editRecordAction } from "@/app/(app)/library/record/actions";
import type { EditOp } from "@/lib/career/edit-schema";
import type { SourceInfo } from "@/lib/career/service";
import { PromptDialog, type OpenPrompt, type PromptSpec } from "./prompt-dialog";

type RecordEdit = {
  /** Applies one edit as a new record version. Resolves true when it was saved. */
  run: (op: EditOp, success?: string) => Promise<boolean>;
  /** Opens the shared dialog. */
  ask: (spec: PromptSpec) => void;
  sources: Record<string, SourceInfo>;
};

const Ctx = createContext<RecordEdit | null>(null);

export function useRecordEdit(): RecordEdit {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRecordEdit must be used inside RecordEditProvider");
  return ctx;
}

/** Holds the record version being looked at, saves edits against it, and owns the one dialog the edit menus share. */
export function RecordEditProvider({
  version,
  sources,
  children,
}: {
  version: number;
  sources: Record<string, SourceInfo>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<OpenPrompt | null>(null);
  const nextKey = useRef(0);

  const run = useCallback(
    async (op: EditOp, success?: string) => {
      const res = await editRecordAction(op, version);
      if (res.ok) {
        toast.success(success ?? res.note ?? "Saved");
        router.refresh();
        return true;
      }
      toast.error(res.error);
      // The record moved on under us, or the thing is gone: show what is there now.
      if (res.stale) router.refresh();
      return false;
    },
    [version, router],
  );

  const ask = useCallback((s: PromptSpec) => setSpec({ ...s, key: ++nextKey.current }), []);
  const value = useMemo(() => ({ run, ask, sources }), [run, ask, sources]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <PromptDialog spec={spec} onClose={() => setSpec(null)} />
    </Ctx.Provider>
  );
}
