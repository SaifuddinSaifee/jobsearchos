import {
  Briefcase,
  Building2,
  Compass,
  LayoutDashboard,
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
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/new", label: "New Application", icon: PlusCircle },
  { href: "/links", label: "Quick links", icon: Rocket },
  { href: "/companies", label: "Companies", icon: Building2, childLabel: "Company profile" },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function isActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV.find((item) => isActive(item, pathname));
}
