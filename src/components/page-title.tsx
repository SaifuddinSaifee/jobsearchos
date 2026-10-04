"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemFor } from "./nav";

/**
 * The current page's name, shown in the top bar next to the sidebar toggle. This is the page's only `h1`.
 * On a page below a section (a single company) it reads "Companies, then Company profile", with the section
 * name linking back.
 */
export function PageTitle() {
  const pathname = usePathname();
  const item = navItemFor(pathname);
  if (!item) return null;
  const nested = pathname !== item.href && Boolean(item.childLabel);

  return (
    <h1
      key={pathname}
      className="flex min-w-0 items-center gap-1.5 text-sm font-medium animate-in fade-in slide-in-from-left-1 duration-200 motion-reduce:animate-none"
    >
      {nested ? (
        <>
          <Link
            href={item.href}
            className="truncate rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.label}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{item.childLabel}</span>
        </>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
    </h1>
  );
}
