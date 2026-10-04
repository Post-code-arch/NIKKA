import * as React from "react";
import { Asterisk } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Presentational node shell (docs/design/DESIGN.md): title sits above the
 * card, optional action chip on the right, optional glow when focused/running.
 */
export function NodeCard({
  title,
  action,
  glow,
  width = 240,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  /** CSS color of the focus halo, e.g. "var(--port-image)". */
  glow?: string;
  width?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative", className)} style={{ width }}>
      {glow && (
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-10 -z-10 rounded-full opacity-35 blur-3xl"
          style={{ background: `radial-gradient(closest-side, ${glow}, transparent)` }}
        />
      )}
      <div className="mb-2 flex h-6 items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-[11px] text-foreground/90">
          <Asterisk className="size-3" />
          {title}
        </span>
        {action}
      </div>
      <div
        className={cn(
          "rounded-[14px] border bg-surface p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]",
          glow && "border-white/12",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Inner panel of a node card. */
export function NodePanel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("rounded-[10px] bg-surface-2 p-3", className)} {...props} />;
}

/** "Label …… control" row. */
export function NodeField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** Dark value box used as a field control. */
export function NodeValue({ className, mono, ...props }: React.ComponentProps<"div"> & { mono?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-24 items-center justify-between gap-2 rounded-md bg-surface px-2 text-[11px] text-foreground [&_svg]:size-3 [&_svg]:text-muted-foreground",
        mono && "font-mono",
        className,
      )}
      {...props}
    />
  );
}

/** Small green action chip shown in node headers (e.g. « Générer »). */
export function NodeChip({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md bg-go px-2 text-[10px] font-medium text-black [&_svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export function PortDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
