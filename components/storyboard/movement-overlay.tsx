import type { CameraAttrs } from "@/lib/camera/types";

/**
 * Camera movement drawn over the shot image (PRD §10), like the arrows of a
 * hand-drawn storyboard. 160 × 90 space, white strokes with a dark halo.
 */

type Move = CameraAttrs["movement"];

const HEAD = 6;

function arrow(x1: number, y1: number, x2: number, y2: number) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h1 = [x2 - HEAD * Math.cos(a - 0.5), y2 - HEAD * Math.sin(a - 0.5)];
  const h2 = [x2 - HEAD * Math.cos(a + 0.5), y2 - HEAD * Math.sin(a + 0.5)];
  return `M${x1} ${y1} L${x2} ${y2} M${h1[0]} ${h1[1]} L${x2} ${y2} L${h2[0]} ${h2[1]}`;
}

/** Four corner arrows, toward the centre (in) or away from it (out). */
function corners(inward: boolean, inset = 0) {
  const pts: [number, number, number, number][] = [
    [18, 14, 46, 30],
    [142, 14, 114, 30],
    [18, 76, 46, 60],
    [142, 76, 114, 60],
  ];
  return pts
    .map(([ax, ay, bx, by]) => {
      const [x1, y1, x2, y2] = inward ? [ax, ay, bx, by] : [bx, by, ax, ay];
      return arrow(x1 + (inward ? inset : 0), y1, x2, y2);
    })
    .join(" ");
}

const PATHS: Partial<Record<Move, string>> = {
  pan_left: arrow(120, 45, 40, 45),
  pan_right: arrow(40, 45, 120, 45),
  tilt_up: arrow(80, 72, 80, 18),
  tilt_down: arrow(80, 18, 80, 72),
  dolly_in: corners(true),
  dolly_out: corners(false),
  zoom_in: corners(true),
  zoom_out: corners(false),
  truck_left: `${arrow(120, 78, 40, 78)} M40 84 L120 84`,
  truck_right: `${arrow(40, 78, 120, 78)} M40 84 L120 84`,
  crane_up: `${arrow(146, 74, 146, 16)} M152 74 L152 16`,
  crane_down: `${arrow(146, 16, 146, 74)} M152 74 L152 16`,
  orbit_left: `M112 62 C 90 80, 60 78, 46 60 ${arrow(52, 66, 44, 56)}`,
  orbit_right: `M48 62 C 70 80, 100 78, 114 60 ${arrow(108, 66, 116, 56)}`,
  drone: `M24 70 C 60 20, 100 20, 136 40 ${arrow(128, 36, 138, 41)}`,
  handheld: "M40 46 L50 40 L60 50 L70 41 L80 49 L90 40 L100 50 L110 42 L120 47",
  dolly_zoom: `${corners(true)} M70 45 L90 45 M80 35 L80 55`,
};

export function MovementOverlay({ movement, className }: { movement: Move; className?: string }) {
  const d = PATHS[movement];
  if (!d) return null;
  const dashed = movement === "zoom_in" || movement === "zoom_out";
  return (
    <svg viewBox="0 0 160 90" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path
        d={d}
        fill="none"
        stroke="white"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "4 3" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
