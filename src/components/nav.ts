import {
  Briefcase,
  Building2,
  Compass,
  Gauge,
  LayoutDashboard,
  LibraryBig,
  PlusCircle,
  Rocket,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown after the section name in the top bar on pages below this one (e.g. a single company). */
  childLabel?: string;
};

/** The app's sections. Drives both the sidebar and the page title in the top bar. */
export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase, childLabel: "Outreach" },
  { href: "/new", label: "New Application", icon: PlusCircle },
  { href: "/links", label: "Quick links", icon: Rocket },
  { href: "/companies", label: "Companies", icon: Building2, childLabel: "Company profile" },
  { href: "/library", label: "Library", icon: LibraryBig, childLabel: "Document" },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/usage", label: "AI usage", icon: Gauge },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** What a page below a section is called in the top bar, when its section's `childLabel` would be wrong for it. */
export function childLabelFor(item: NavItem, pathname: string): string | undefined {
  if (item.href === "/library" && pathname.startsWith("/library/record")) return "Career record review";
  return item.childLabel;
}

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV.find((item) => isActive(item, pathname));
}
