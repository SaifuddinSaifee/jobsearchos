export function ComingSoon({ title, stage }: { title: string; stage: number }) {
  return (
    <div className="mx-auto max-w-2xl space-y-2 pt-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">Coming in Stage {stage}. See docs/PLAN.md.</p>
    </div>
  );
}
