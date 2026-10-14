import { Skeleton } from "@/components/ui/skeleton";

/** The shape of the usage page (range tabs, tiles, chart, a table), shown while the numbers are worked out. */
export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading AI usage"
      className="space-y-6 animate-in fade-in duration-300 [--tw-animation-delay:150ms] [--tw-animation-fill-mode:backwards] motion-reduce:animate-none"
    >
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
