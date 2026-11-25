import { EMBLEM_PATH, EMBLEM_SIZE } from "@/lib/brand-emblem";

/** NIKKA emblem, in the current ink colour (never a pigment). */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${EMBLEM_SIZE} ${EMBLEM_SIZE}`} shapeRendering="crispEdges" className={`text-foreground ${className}`} role="img" aria-label="NIKKA">
      <path fill="currentColor" d={EMBLEM_PATH} />
    </svg>
  );
}
