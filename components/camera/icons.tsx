import type { CameraAttrs } from "@/lib/camera/types";
import { cn } from "@/lib/utils";

/**
 * Simple line pictograms for shot scale, camera angle and movement (PRD §8).
 * 24×24, stroke = currentColor, so they follow the text color.
 */

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      {children}
    </svg>
  );
}

/** A standing figure in its own space: head at y≈-37, feet at y=40. Strokes keep their width at any zoom. */
function Figure({ eyes }: { eyes: boolean }) {
  const line = { ...STROKE, strokeWidth: 1.4, vectorEffect: "non-scaling-stroke" as const };
  return (
    <g>
      <circle cx="0" cy="-37" r="7" {...line} />
      {eyes && (
        <>
          <circle cx="-2.6" cy="-38" r="0.9" fill="currentColor" />
          <circle cx="2.6" cy="-38" r="0.9" fill="currentColor" />
        </>
      )}
      <path d="M -11 -26 L 11 -26 L 9 6 L -9 6 Z" {...line} />
      <path d="M -6 6 L -5 40 M 6 6 L 5 40" {...line} />
      <path d="M -11 -24 L -15 2 M 11 -24 L 15 2" {...line} />
    </g>
  );
}

/** Part of the figure space framed by each scale (x, y, w, h — 4:3). */
const FRAMING: Record<Exclude<CameraAttrs["scale"], "insert">, [number, number, number, number]> = {
  extreme_wide: [-200, -110, 400, 300],
  wide: [-100, -62, 200, 150],
  full: [-60, -49, 120, 90],
  cowboy: [-44, -49, 88, 66],
  medium: [-32, -48, 64, 48],
  medium_close: [-24, -48, 48, 36],
  close: [-16, -47, 32, 24],
  extreme_close: [-6, -41.5, 12, 9],
};

export function ScaleIcon({ scale, className }: { scale: CameraAttrs["scale"]; className?: string }) {
  if (scale === "insert") {
    return (
      <Svg className={className}>
        <rect x="2" y="5" width="20" height="14" rx="2" {...STROKE} />
        <path d="M8 16 L9 10 L15 10 L16 16 Z M15 11.5 h1.6 a1.5 1.5 0 0 1 0 3 H15.4" {...STROKE} strokeWidth={1.3} />
      </Svg>
    );
  }
  const [x, y, w, h] = FRAMING[scale];
  return (
    <Svg className={className}>
      <rect x="2" y="5" width="20" height="14" rx="2" {...STROKE} />
      <svg x="2.75" y="5.75" width="18.5" height="12.5" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid slice">
        {scale === "extreme_wide" && <path d="M -200 40 L 200 40" {...STROKE} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
        <Figure eyes={scale === "close" || scale === "extreme_close" || scale === "medium_close"} />
      </svg>
    </Svg>
  );
}

function Camera({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} {...STROKE}>
      <rect x="-3.5" y="-2.5" width="5" height="5" rx="1" />
      <path d="M1.5 -1.5 L4 -3 V3 L1.5 1.5" />
    </g>
  );
}

function MiniFigure() {
  return (
    <g {...STROKE}>
      <circle cx="18" cy="8" r="1.8" />
      <path d="M18 10 V16 M18 16 L16.5 21 M18 16 L19.5 21 M15.5 12.5 H20.5" />
    </g>
  );
}

export function AngleIcon({ angle, className }: { angle: CameraAttrs["angle"]; className?: string }) {
  return (
    <Svg className={className}>
      {angle === "eye_level" && (
        <>
          <MiniFigure />
          <Camera x={5} y={8} />
          <path d="M9.5 8 H14.5" {...STROKE} strokeDasharray="1.5 1.5" />
        </>
      )}
      {angle === "high" && (
        <>
          <MiniFigure />
          <Camera x={5} y={3.5} rotate={30} />
          <path d="M8.5 5.5 L15 9.5" {...STROKE} strokeDasharray="1.5 1.5" />
        </>
      )}
      {angle === "low" && (
        <>
          <MiniFigure />
          <Camera x={5} y={19.5} rotate={-30} />
          <path d="M8.5 17.5 L15.5 10.5" {...STROKE} strokeDasharray="1.5 1.5" />
        </>
      )}
      {angle === "overhead" && (
        <>
          <Camera x={12} y={4} rotate={90} />
          <path d="M12 8 V13" {...STROKE} strokeDasharray="1.5 1.5" />
          <ellipse cx="12" cy="17.5" rx="5" ry="2.5" {...STROKE} />
          <circle cx="12" cy="17.5" r="1.3" {...STROKE} />
        </>
      )}
      {angle === "dutch" && (
        <>
          <rect x="4" y="6" width="16" height="12" rx="1.5" transform="rotate(-14 12 12)" {...STROKE} />
          <path d="M6 15 L18 11" {...STROKE} strokeDasharray="1.5 1.5" />
        </>
      )}
    </Svg>
  );
}

const ARROW = (d: string, head: string) => (
  <>
    <path d={d} {...STROKE} />
    <path d={head} {...STROKE} />
  </>
);

export function MovementIcon({ movement, className }: { movement: CameraAttrs["movement"]; className?: string }) {
  switch (movement) {
    case "static":
      return (
        <Svg className={className}>
          <Camera x={12} y={8} />
          <path d="M12 11 L8 20 M12 11 L16 20 M12 11 V20" {...STROKE} />
        </Svg>
      );
    case "pan_left":
    case "pan_right": {
      const left = movement === "pan_left";
      return (
        <Svg className={className}>
          <Camera x={12} y={15} />
          {left
            ? ARROW("M18 9 Q12 3 6 9", "M6 5.5 V9 H9.5")
            : ARROW("M6 9 Q12 3 18 9", "M18 5.5 V9 H14.5")}
        </Svg>
      );
    }
    case "tilt_up":
    case "tilt_down": {
      const up = movement === "tilt_up";
      return (
        <Svg className={className}>
          <Camera x={9} y={12} />
          {up ? ARROW("M15 18 Q20 12 15 6", "M18.5 6 H15 V9.5") : ARROW("M15 6 Q20 12 15 18", "M18.5 18 H15 V14.5")}
        </Svg>
      );
    }
    case "dolly_in":
    case "dolly_out": {
      const inward = movement === "dolly_in";
      return (
        <Svg className={className}>
          <rect x="15" y="7" width="7" height="10" rx="1" {...STROKE} />
          <Camera x={5} y={12} />
          {inward ? ARROW("M9 12 H13.5", "M11.5 10 L13.5 12 L11.5 14") : ARROW("M13.5 12 H9", "M11 10 L9 12 L11 14")}
          <path d="M2 19 H12" {...STROKE} strokeDasharray="1.5 1.5" />
        </Svg>
      );
    }
    case "truck_left":
    case "truck_right": {
      const left = movement === "truck_left";
      return (
        <Svg className={className}>
          <Camera x={12} y={8} />
          <path d="M3 19 H21" {...STROKE} strokeDasharray="1.5 1.5" />
          {left ? ARROW("M17 14 H6", "M8.5 11.5 L6 14 L8.5 16.5") : ARROW("M7 14 H18", "M15.5 11.5 L18 14 L15.5 16.5")}
        </Svg>
      );
    }
    case "orbit_left":
    case "orbit_right": {
      const left = movement === "orbit_left";
      return (
        <Svg className={className}>
          <circle cx="12" cy="12" r="2" {...STROKE} />
          <ellipse cx="12" cy="12" rx="9" ry="5" {...STROKE} />
          {left ? <path d="M5.5 15.8 L3.2 13.4 L6.4 12.6" {...STROKE} /> : <path d="M18.5 15.8 L20.8 13.4 L17.6 12.6" {...STROKE} />}
        </Svg>
      );
    }
    case "crane_up":
    case "crane_down": {
      const up = movement === "crane_up";
      return (
        <Svg className={className}>
          <path d="M5 21 L5 15 L14 8" {...STROKE} />
          <Camera x={17} y={7} />
          {up ? ARROW("M20 18 V12", "M18 14 L20 12 L22 14") : ARROW("M20 12 V18", "M18 16 L20 18 L22 16")}
        </Svg>
      );
    }
    case "drone":
      return (
        <Svg className={className}>
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" {...STROKE} />
          <path d="M9.5 9.5 L6 6 M14.5 9.5 L18 6 M9.5 14.5 L6 18 M14.5 14.5 L18 18" {...STROKE} />
          <path d="M3.5 6 H8.5 M15.5 6 H20.5 M3.5 18 H8.5 M15.5 18 H20.5" {...STROKE} />
        </Svg>
      );
    case "handheld":
      return (
        <Svg className={className}>
          <Camera x={12} y={8} rotate={-8} />
          <path d="M3 17 Q5 14 7 17 T11 17 T15 17 T19 17 T21 16" {...STROKE} />
        </Svg>
      );
    case "zoom_in":
    case "zoom_out": {
      const inward = movement === "zoom_in";
      return (
        <Svg className={className}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" {...STROKE} />
          <rect x="9" y="9.5" width="6" height="5" rx="0.8" {...STROKE} />
          {inward ? (
            <path d="M4.5 6.5 L8 9 M19.5 6.5 L16 9 M4.5 17.5 L8 15 M19.5 17.5 L16 15" {...STROKE} />
          ) : (
            <path d="M8 9 L4.5 6.5 M16 9 L19.5 6.5 M8 15 L4.5 17.5 M16 15 L19.5 17.5" {...STROKE} strokeDasharray="2 1" />
          )}
        </Svg>
      );
    }
    case "dolly_zoom":
      return (
        <Svg className={className}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" {...STROKE} />
          <circle cx="12" cy="12" r="2" {...STROKE} />
          <path d="M5 8 L8 10 M19 8 L16 10 M5 16 L8 14 M19 16 L16 14" {...STROKE} />
          <path d="M2 21.5 H8 M16 21.5 H22" {...STROKE} />
        </Svg>
      );
  }
}
