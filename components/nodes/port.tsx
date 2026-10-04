"use client";

import { Handle, Position, useNodeConnections } from "@xyflow/react";
import { cn } from "@/lib/utils";

/**
 * Typed port. The handle sits on the card border, vertically aligned with
 * its row; the label stays inside the card.
 * `edgeOffset` = distance in px from the row's edge to the card's outer border.
 */
export function Port({
  id,
  kind,
  color,
  label,
  edgeOffset = 19,
  className,
}: {
  id: string;
  kind: "source" | "target";
  color: string;
  label?: string;
  edgeOffset?: number;
  className?: string;
}) {
  const isOut = kind === "source";
  const connections = useNodeConnections({ handleType: kind, handleId: id });
  const connected = connections.length > 0;
  return (
    <div
      className={cn(
        "relative flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground",
        isOut && "flex-row-reverse",
        className,
      )}
    >
      <Handle
        id={id}
        type={kind}
        position={isOut ? Position.Right : Position.Left}
        className="nk-port"
        data-connected={connected}
        style={{
          ["--port-color" as string]: color,
          ...(isOut ? { right: -edgeOffset } : { left: -edgeOffset }),
        }}
      />
      {label && <span className={cn(connected && "text-foreground/80")}>{label}</span>}
    </div>
  );
}
