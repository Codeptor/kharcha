"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@workspace/ui/lib/utils"

const {
  Arrow: TooltipArrowPrimitive,
  Content: TooltipContentPrimitive,
  Portal: TooltipPortalPrimitive,
  Provider: TooltipProviderPrimitive,
  Root: TooltipRootPrimitive,
  Trigger: TooltipTriggerPrimitive,
} = TooltipPrimitive

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipProviderPrimitive>) {
  return <TooltipProviderPrimitive delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipRootPrimitive>) {
  return <TooltipRootPrimitive {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipTriggerPrimitive>) {
  return <TooltipTriggerPrimitive {...props} />
}

function TooltipContent({
  className,
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipContentPrimitive>) {
  return (
    <TooltipPortalPrimitive>
      <TooltipContentPrimitive
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-2xl border border-border/70 bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-2xl outline-none animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipArrowPrimitive className="fill-border/70" />
      </TooltipContentPrimitive>
    </TooltipPortalPrimitive>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
