import { QuickLinksBoard } from "@/components/quick-links/quick-links";
import { listQuickLinks } from "@/lib/quick-links/service";

export const dynamic = "force-dynamic";

export default async function QuickLinksPage() {
  const links = await listQuickLinks();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        The job boards and careers pages you check every day. Each card is marked once you open it, and resets at midnight.
      </p>
      <QuickLinksBoard links={links} />
    </div>
  );
}
