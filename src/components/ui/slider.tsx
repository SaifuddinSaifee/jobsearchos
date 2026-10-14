"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "@/lib/utils"

/** A single-value slider. `onValueChange` receives a number. */
function Slider({
  className,
  ...props
}: Omit<SliderPrimitive.Root.Props<number>, "value" | "defaultValue" | "onValueChange" | "onValueCommitted"> & {
  value: number
  onValueChange: (value: number) => void
  onValueCommitted?: (value: number) => void
}) {
  const { value, onValueChange, onValueCommitted, ...rest } = props
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      onValueChange={(v) => onValueChange(Array.isArray(v) ? v[0] : v)}
      onValueCommitted={onValueCommitted ? (v) => onValueCommitted(Array.isArray(v) ? v[0] : v) : undefined}
      className={cn("w-full", className)}
      {...rest}
    >
      <SliderPrimitive.Control className="flex h-6 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb className="size-4 rounded-full border border-primary bg-background shadow-sm outline-none transition-[scale,box-shadow] duration-150 hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 data-dragging:scale-110 motion-reduce:transition-none" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
