"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { deleteAction, duplicateAction, setBaseAction, type Result } from "@/app/(app)/library/actions";
import { RESUME_INDEXES_KEY } from "@/components/resume/use-resume-indexes";

/** The things you can do to a document from a list or its page, each with a toast and a refresh. */
export function useDocumentActions() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run<T extends object>(id: string, fn: () => Promise<Result<T>>, done: (r: { ok: true } & T) => void) {
    setBusyId(id);
    const res = await fn();
    setBusyId(null);
    if (!res.ok) return void toast.error(res.error);
    done(res);
    void queryClient.invalidateQueries({ queryKey: RESUME_INDEXES_KEY });
    router.refresh();
  }

  return {
    busyId,
    duplicate: (id: string) =>
      run(id, () => duplicateAction(id), (r) =>
        toast.success("Copied", { action: { label: "Open", onClick: () => router.push(`/library/${(r as { id: string }).id}`) } }),
      ),
    setBase: (id: string) => run(id, () => setBaseAction(id), () => toast.success("This is now your base resume")),
    remove: (id: string, after?: () => void) =>
      run(id, () => deleteAction(id), () => {
        toast.success("Deleted");
        after?.();
      }),
  };
}
