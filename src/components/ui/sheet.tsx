"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
        className
      )}
      {...props}
    />
  )
}

/**
 * Shared app drawer — ONE component used by every sheet/drawer in the app.
 *
 * Motion contract (visual only, no behaviour change):
 * - Side drawers slide with a 300ms ease transform (translate), Radix Presence
 *   awaits the transition so exit animation always completes.
 * - On phones (<sm) right/left drawers become bottom sheets: full viewport
 *   width, up to 92dvh tall, rounded top, grab handle — they can never clip
 *   the viewport.
 * - From sm up they slide from their side at 3/4 width (callers may override
 *   the max-width, e.g. the record form's sm:max-w-3xl).
 * - The overlay dims + softly blurs and dismisses on click.
 * - The close button is always visible above the content (z-20).
 */
function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  const isSide = side === "right" || side === "left"
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-background/85 backdrop-blur-2xl [box-shadow:var(--shadow-soft-lg),inset_0_1px_0_var(--glass-highlight)] data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col overflow-hidden",
          // Unified 300ms transform slide for side drawers; the data-state
          // translate utilities below drive it in BOTH directions.
          isSide &&
            "transition-transform duration-300 ease-in-out will-change-transform motion-reduce:transition-none",
          side === "right" &&
            cn(
              // Phone: bottom sheet — full width, ≤92dvh, rounded top.
              "inset-x-0 bottom-0 max-h-[92dvh] w-full translate-y-full rounded-t-2xl border-t data-[state=open]:translate-y-0",
              // sm+: right drawer.
              "sm:inset-x-auto sm:bottom-auto sm:top-0 sm:right-0 sm:h-full sm:max-h-full sm:w-3/4 sm:max-w-sm sm:translate-y-0 sm:translate-x-full sm:rounded-bl-2xl sm:rounded-t-none sm:border-l sm:border-t-0 sm:data-[state=open]:translate-x-0"
            ),
          side === "left" &&
            cn(
              "inset-x-0 bottom-0 max-h-[92dvh] w-full translate-y-full rounded-t-2xl border-t data-[state=open]:translate-y-0",
              "sm:inset-x-auto sm:bottom-auto sm:top-0 sm:left-0 sm:h-full sm:max-h-full sm:w-3/4 sm:max-w-sm sm:translate-y-0 sm:-translate-x-full sm:rounded-br-2xl sm:rounded-t-none sm:border-r sm:border-t-0 sm:data-[state=open]:translate-x-0"
            ),
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className
        )}
        {...props}
      >
        {/* Grab handle — bottom-sheet affordance on phones only. */}
        {isSide && (
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-2 z-20 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/25 sm:hidden"
          />
        )}
        {children}
        <SheetPrimitive.Close
          className="absolute right-3 top-3 z-20 flex size-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground ring-1 ring-border backdrop-blur transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none sm:right-4 sm:top-4 sm:size-7"
          aria-label="Close"
        >
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
