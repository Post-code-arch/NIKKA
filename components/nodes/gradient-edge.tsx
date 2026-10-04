"use client";

import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";

export type GradientEdgeData = { from: string; to?: string };

/** Thin bezier fading from the source port color to light grey. */
export function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<GradientEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const gid = `nk-edge-${id}`;
  const from = data?.from ?? "var(--edge)";
  return (
    <>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={data?.to ?? "rgba(255,255,255,0.75)"} />
        </linearGradient>
      </defs>
      <BaseEdge id={id} path={path} style={{ stroke: `url(#${gid})`, strokeWidth: 1.5 }} />
    </>
  );
}
