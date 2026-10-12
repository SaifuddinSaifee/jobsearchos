"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { restoreVersionAction } from "@/app/(app)/profile/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type VersionRow = {
  id: string;
  version: number;
  changeNote: string | null;
  createdAt: string;
  data: string;
};

export function History({ versions, latest }: { versions: VersionRow[]; latest: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (versions.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing saved yet.</p>;
  }

  return (
    <ul className="max-w-3xl divide-y rounded-lg border">
      {versions.map((v) => (
        <li key={v.id} className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">Version {v.version}</span>
              {v.version === latest && <Badge>Current</Badge>}
              <span className="text-muted-foreground">
                {new Date(v.createdAt).toLocaleString()}
                {v.changeNote ? ` · ${v.changeNote}` : ""}
              </span>
            </div>
            {v.version !== latest && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await restoreVersionAction(v.id);
                    if (result.ok) {
                      toast.success(`Restored as version ${result.version}`);
                      router.refresh();
                    } else {
                      toast.error(result.error);
                    }
                  })
                }
              >
                Restore as new version
              </Button>
            )}
          </div>
          <details>
            <summary className="text-xs text-muted-foreground hover:text-foreground">View (read-only)</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{v.data}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}
