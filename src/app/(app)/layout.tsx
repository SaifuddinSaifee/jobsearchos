import { AppSidebar } from "@/components/app-sidebar";
import { PageTitle } from "@/components/page-title";
import { QueueNotifier } from "@/components/queue/queue-notifier";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <QueueNotifier />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-backdrop-filter:bg-background/70">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-vertical:h-4 data-vertical:self-center" />
          <PageTitle />
        </header>
        {/* Every page shares this one width and padding, so switching pages never shifts the content edge. */}
        <div className="mx-auto w-full max-w-6xl min-w-0 flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
