import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A plain `<select>` styled like `Input`: same border, hover, focus ring and timing, with a chevron in place of the
 * browser's arrow. Works with react-hook-form's `register` (forwards the ref).
 */
function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div className={cn("group/native-select relative w-full", className)}>
      <select
        data-slot="native-select"
        className={cn(
          "w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent pr-8 pl-2.5 text-sm text-foreground transition-[color,background-color,border-color,box-shadow] duration-150 outline-none hover:not-focus-visible:not-disabled:border-foreground/25 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground",
          size === "sm" ? "h-7 rounded-md pl-2" : "h-8"
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-hover/native-select:text-foreground"
      />
    </div>
  )
}

export { NativeSelect }
