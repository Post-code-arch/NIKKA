"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { assetUrl } from "@/lib/store/api";
import { cn } from "@/lib/utils";

/** Square thumbnail of a local asset, or a status placeholder. */
export function Thumb({
  assetId,
  status,
  className,
}: {
  assetId?: string | null;
  status?: "queued" | "processing" | "completed" | "failed";
  className?: string;
}) {
  if (status === "queued" || status === "processing") {
    return (
      <div className={cn("grid place-items-center rounded-md bg-surface-2 text-muted-foreground", className)}>
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (status === "failed" || !assetId) {
    return (
      <div className={cn("grid place-items-center rounded-md bg-surface-2 text-destructive", className)}>
        <AlertCircle className="size-4" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={assetUrl(assetId)} alt="" className={cn("rounded-md bg-surface-2 object-cover", className)} />;
}
