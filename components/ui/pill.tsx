import * as React from "react";
import { cn } from "@/lib/utils";

export function pillClass(active?: boolean, className?: string) {
  return cn(
    "inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-xs text-muted-foreground transition-colors",
    "bg-surface-2 hover:bg-surface-3 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
    active && "bg-surface-3 text-foreground",
    className,
  );
}

/** Dark rounded control used for menus, selectors and toolbar items. */
export function Pill({
  className,
  active,
  ...props
}: React.ComponentProps<"button"> & { active?: boolean }) {
  return <button type="button" className={pillClass(active, className)} {...props} />;
}

export function IconPill({ className, ...props }: React.ComponentProps<"button">) {
  return <Pill className={cn("w-8 justify-center px-0", className)} {...props} />;
}

/** Group of controls on one floating island. */
export function Island({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("island flex items-center gap-1 p-1", className)} {...props} />;
}
