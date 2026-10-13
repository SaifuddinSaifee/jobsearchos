"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every few seconds while something is being prepared in the background, then hands over to the editor. */
export function AutoRefresh({ message, everyMs = 2500 }: { message: string; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return (
    <p role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm animate-in fade-in duration-200 motion-reduce:animate-none">
      <Loader2 className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /> {message}
    </p>
  );
}
