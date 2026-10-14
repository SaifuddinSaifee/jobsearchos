"use client";

import type { Editor } from "@tiptap/core";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addAfter, beginBlockDrag, blockAt, blockMoves, endBlockDrag, runBlockAction } from "./commands";

type Target = { pos: number; top: number; left: number };

/**
 * The handle in the margin beside whatever the pointer is over: a role, a bullet, a whole section. Drag the grip to
 * move it (the page's own drag and drop does the rest, and only allows places the block can go), click it for the menu,
 * or press the plus to add something below. The handle stays put while its menu is open.
 */
export function BlockHandle({ editor, wrap }: { editor: Editor; wrap: React.RefObject<HTMLDivElement | null> }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    open.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      if (open.current || dragging.current || !editor.isEditable) return;
      const page = editor.view.dom.getBoundingClientRect();
      // Over the margin the pointer is outside the page; look along the same line, just inside it.
      const left = Math.min(Math.max(e.clientX, page.left + 24), page.right - 24);
      const hit = editor.view.posAtCoords({ left, top: e.clientY });
      if (!hit) return;
      const block = blockAt(editor, hit.pos);
      const dom = block ? (editor.view.nodeDOM(block.pos) as HTMLElement | null) : null;
      if (!block || !dom?.getBoundingClientRect) return setTarget(null);
      const rect = dom.getBoundingClientRect();
      const outer = el.getBoundingClientRect();
      const next = { pos: block.pos, top: rect.top - outer.top, left: page.left - outer.left };
      setTarget((old) => (old && old.pos === next.pos && Math.abs(old.top - next.top) < 1 ? old : next));
    };
    const onLeave = () => {
      if (!open.current && !dragging.current) setTarget(null);
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, wrap]);

  if (!target || !editor.isEditable) return null;
  const moves = blockMoves(editor, target.pos);

  function startDrag(e: React.DragEvent) {
    if (!target) return;
    dragging.current = true;
    beginBlockDrag(editor, target.pos, e.dataTransfer);
  }

  return (
    <div className="absolute z-10 flex items-center gap-0.5 animate-in fade-in duration-150 motion-reduce:animate-none" style={{ top: target.top, left: target.left - 56 }}>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Add a block below" title="Add below" onMouseDown={(e) => e.preventDefault()} onClick={() => addAfter(editor, target.pos)}>
        <Plus />
      </Button>
      {/* The menu opens on click, not on press, so that pressing and dragging the grip moves the block instead. */}
      <DropdownMenu open={menuOpen} onOpenChange={(next, details) => (next && details.reason === "trigger-press" && details.event.type !== "click" ? undefined : setMenuOpen(next))}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              draggable
              aria-label="Drag to move, or click for options"
              title="Drag to move, click for options"
              onClick={() => setMenuOpen((v) => !v)}
              onDragStart={startDrag}
              onDragEnd={() => {
                dragging.current = false;
                endBlockDrag(editor);
              }}
              className="inline-flex size-6 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,scale] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 active:cursor-grabbing"
            />
          }
        >
          <GripVertical className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="left" className="w-44">
          <DropdownMenuItem onClick={() => runBlockAction(editor, target.pos, "duplicate")}>
            <Copy aria-hidden /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!moves.up} onClick={() => runBlockAction(editor, target.pos, "up")}>
            <ArrowUp aria-hidden /> Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!moves.down} onClick={() => runBlockAction(editor, target.pos, "down")}>
            <ArrowDown aria-hidden /> Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => runBlockAction(editor, target.pos, "delete")}>
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
