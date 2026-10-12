import { cn } from "@/lib/utils"

/**
 * Smoothly expands and collapses its content (height and opacity) using the grid-rows trick, so no height needs
 * to be measured. Collapsed content is inert (not focusable, hidden from assistive tech).
 */
function Collapse({
  open,
  className,
  children,
}: {
  open: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  )
}

export { Collapse }
