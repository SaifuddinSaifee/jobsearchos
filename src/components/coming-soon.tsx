/** Placeholder for a section that is not built yet. The page name comes from the top bar. */
export function ComingSoon({ stage }: { stage: number }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      Coming in Stage {stage}. See docs/PLAN.md.
    </div>
  );
}
