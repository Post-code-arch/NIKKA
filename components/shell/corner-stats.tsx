import { cn } from "@/lib/utils";

/** Monospace readouts pinned to a bottom corner of the canvas. */
export function CornerStats({
  items,
  side,
}: {
  items: [label: string, value: string][];
  side: "left" | "right";
}) {
  return (
    <dl
      className={cn(
        "pointer-events-none fixed bottom-4 z-10 grid grid-cols-[auto_auto] gap-x-1.5 font-mono text-[10px] leading-4 text-muted-foreground",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}:</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
