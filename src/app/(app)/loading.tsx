import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment you click a sidebar link while the server renders the page (most pages read the database or
 * call out to an API). It fades in after a short delay, so fast navigations do not flash a skeleton.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading page"
      className="mx-auto max-w-5xl space-y-6 animate-in fade-in duration-300 [--tw-animation-delay:150ms] [--tw-animation-fill-mode:backwards] motion-reduce:animate-none"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
