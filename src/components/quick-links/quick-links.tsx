"use client";

import { ArrowDown, ArrowUp, Check, MoreHorizontal, Pencil, Plus, Rocket } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { markQuickLinksOpenedAction, moveQuickLinkAction } from "@/app/(app)/links/actions";
import { useNow } from "@/components/jobs/use-now";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QuickLink } from "@/lib/quick-links/types";
import { cn } from "@/lib/utils";
import { LinkEditor } from "./link-editor";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function openedOn(iso: string | null, now: Date | null): boolean {
  return Boolean(iso && now && new Date(iso).toDateString() === now.toDateString());
}

/** The site's icon from Google's favicon service, or its first letter if that fails to load. */
function SiteIcon({ url, title }: { url: string; title: string }) {
  const host = hostOf(url);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold uppercase text-muted-foreground">
        {(title.trim() || host).charAt(0)}
      </span>
    );
  }
  return (
    // A 32px icon from another site gains nothing from next/image optimisation.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-8 shrink-0 rounded-md bg-muted object-contain p-1"
    />
  );
}

/**
 * Opened-today state, with clicks shown immediately instead of waiting for the server round trip.
 * The date is only known in the browser, so nothing is marked during server rendering.
 */
function useDailyRound(links: QuickLink[]) {
  const now = useNow();
  const [justOpened, setJustOpened] = useState<Set<string>>(new Set());
  const isOpened = (l: QuickLink) => justOpened.has(l.id) || openedOn(l.lastOpenedAt, now);

  function record(ids: string[]) {
    if (!ids.length) return;
    setJustOpened((prev) => new Set([...prev, ...ids]));
    void markQuickLinksOpenedAction(ids).then((res) => !res.ok && toast.error(res.error));
  }

  const remaining = links.filter((l) => !isOpened(l));

  function openRemaining() {
    const opened: string[] = [];
    for (const l of remaining) {
      // No "noopener" feature here: with it, window.open always returns null and a blocked tab cannot be detected.
      const w = window.open(l.url, "_blank");
      if (!w) break;
      w.opener = null;
      opened.push(l.id);
    }
    record(opened);
    const blocked = remaining.length - opened.length;
    if (blocked > 0) {
      toast.error(`Your browser blocked ${blocked} tab${blocked === 1 ? "" : "s"}`, {
        description: "Allow pop-ups for this site (in the address bar), then click Open all again.",
      });
    }
  }

  return { now, isOpened, record, remaining, openRemaining };
}

function LinkCard({
  link,
  opened,
  onOpen,
  menu,
  compact,
}: {
  link: QuickLink;
  opened: boolean;
  onOpen: () => void;
  menu?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "group/link relative rounded-xl border bg-card transition-[background-color,border-color,box-shadow,translate,opacity] duration-200 hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm has-[a:active]:translate-y-0",
        opened && "opacity-60 hover:opacity-100",
      )}
    >
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpen}
        // Middle-click opens a tab too, and counts as a visit.
        onAuxClick={(e) => e.button === 1 && onOpen()}
        className={cn(
          "flex items-start gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "p-3" : "p-4",
          menu && "pr-10",
        )}
      >
        <SiteIcon url={link.url} title={link.title} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{link.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{hostOf(link.url)}</span>
          {!compact && link.note && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{link.note}</span>}
          {opened && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 animate-in fade-in duration-200 motion-reduce:animate-none dark:text-emerald-400">
              <Check aria-hidden className="size-3" /> Opened today
            </span>
          )}
        </span>
      </a>
      {menu && <div className="absolute top-2 right-2">{menu}</div>}
    </div>
  );
}

function RoundStatus({ total, remaining, onOpenAll, ready }: { total: number; remaining: number; onOpenAll: () => void; ready: boolean }) {
  const done = total - remaining;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-muted-foreground tabular-nums">
        {ready ? (remaining === 0 ? `All ${total} opened today` : `${done} of ${total} opened today`) : `${total} link${total === 1 ? "" : "s"}`}
      </span>
      <Button size="sm" onClick={onOpenAll} disabled={!ready || remaining === 0}>
        <Rocket aria-hidden />
        {remaining === total ? "Open all" : `Open remaining ${remaining}`}
      </Button>
    </div>
  );
}

/** Links in display order: grouped under their headings, in the order each group first appears. */
function grouped(links: QuickLink[]): [string, QuickLink[]][] {
  const map = new Map<string, QuickLink[]>();
  for (const l of links) map.set(l.group, [...(map.get(l.group) ?? []), l]);
  // Ungrouped links go last, under "Other", once any group exists.
  const ungrouped = map.get("");
  map.delete("");
  const out = [...map.entries()];
  if (ungrouped) out.push([out.length ? "Other" : "", ungrouped]);
  return out;
}

/** The full page: groups, the daily round, and add / edit / reorder. */
export function QuickLinksBoard({ links }: { links: QuickLink[] }) {
  const round = useDailyRound(links);
  const [editing, setEditing] = useState<QuickLink | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const groups = [...new Set(links.map((l) => l.group).filter(Boolean))];

  const openEditor = (l: QuickLink | null) => {
    setEditing(l);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  };

  async function move(l: QuickLink, direction: "up" | "down") {
    const res = await moveQuickLinkAction(l.id, direction);
    if (!res.ok) toast.error(res.error);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {links.length > 0 ? (
          <RoundStatus total={links.length} remaining={round.remaining.length} onOpenAll={round.openRemaining} ready={Boolean(round.now)} />
        ) : (
          <span />
        )}
        <Button variant="outline" onClick={() => openEditor(null)}>
          <Plus aria-hidden /> Add link
        </Button>
      </div>

      {links.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Add the job boards, saved searches and careers pages you check every day. Then open them all with one click each morning.
          </p>
          <Button onClick={() => openEditor(null)}>
            <Plus aria-hidden /> Add your first link
          </Button>
        </div>
      ) : (
        grouped(links).map(([group, items]) => (
          <section key={group || "all"} className="space-y-2">
            {group && <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{group}</h2>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l, i) => (
                <LinkCard
                  key={l.id}
                  link={l}
                  opened={round.isOpened(l)}
                  onOpen={() => round.record([l.id])}
                  menu={
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${l.title}`} />}>
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openEditor(l)}>
                          <Pencil aria-hidden /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={i === 0} onClick={() => void move(l, "up")}>
                          <ArrowUp aria-hidden /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === items.length - 1} onClick={() => void move(l, "down")}>
                          <ArrowDown aria-hidden /> Move down
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}

      <LinkEditor key={editorKey} open={editorOpen} onOpenChange={setEditorOpen} link={editing} groups={groups} />
    </div>
  );
}

/** Compact version for the dashboard: the round at a glance, managed on the Quick links page. */
export function QuickLinksStrip({ links }: { links: QuickLink[] }) {
  const round = useDailyRound(links);
  const ordered = grouped(links).flatMap(([, items]) => items);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Daily round</h2>
        {links.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <RoundStatus total={links.length} remaining={round.remaining.length} onOpenAll={round.openRemaining} ready={Boolean(round.now)} />
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/links" />}>
              <Pencil aria-hidden /> Manage
            </Button>
          </div>
        )}
      </div>
      {links.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">Save the job boards and careers pages you check every day, and open them from here.</p>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/links" />}>
            <Plus aria-hidden /> Add quick links
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {ordered.map((l) => (
            <LinkCard key={l.id} link={l} compact opened={round.isOpened(l)} onOpen={() => round.record([l.id])} />
          ))}
        </div>
      )}
    </section>
  );
}
