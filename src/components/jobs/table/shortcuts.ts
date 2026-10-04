export type ShortcutAction =
  | "focus-search"
  | "next"
  | "prev"
  | "open"
  | "toggle-select"
  | "escape"
  | "mark-applied";

export type KeyInfo = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Tag of the focused element, uppercase (INPUT, TEXTAREA, SELECT, BODY…). */
  tag: string;
  editable: boolean;
  inMenu: boolean;
};

export const SHORTCUT_HELP: { keys: string; action: string }[] = [
  { keys: "/", action: "Focus search" },
  { keys: "j or Down", action: "Next job" },
  { keys: "k or Up", action: "Previous job" },
  { keys: "Enter / o", action: "Open details" },
  { keys: "x", action: "Select / unselect job" },
  { keys: "Shift + A", action: "Mark Applied (job or selection)" },
  { keys: "Esc", action: "Close details, clear selection" },
];

/** Maps a key press to an action. Pure so it can be unit-tested; ignores typing and menus. */
export function resolveShortcut(e: KeyInfo): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Escape") return "escape";
  const typing = e.editable || e.tag === "INPUT" || e.tag === "TEXTAREA" || e.tag === "SELECT";
  if (typing || e.inMenu) return null;

  if (e.shiftKey) return e.key === "A" ? "mark-applied" : null;
  switch (e.key) {
    case "/":
      return "focus-search";
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "prev";
    case "Enter":
      // Enter on a focused button or link must keep its native click.
      return e.tag === "BUTTON" || e.tag === "A" ? null : "open";
    case "o":
      return "open";
    case "x":
      return "toggle-select";
    default:
      return null;
  }
}

export function keyInfoFrom(e: KeyboardEvent): KeyInfo {
  const t = e.target instanceof HTMLElement ? e.target : null;
  return {
    key: e.key,
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    tag: t?.tagName ?? "BODY",
    editable: Boolean(t?.isContentEditable),
    inMenu: Boolean(t?.closest('[role="menu"], [role="listbox"]')),
  };
}
