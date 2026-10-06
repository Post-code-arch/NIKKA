import { z } from "zod";

/** PRD §8. Labels, icons and per-model wording come in phase 3. */
export const ShotScaleSchema = z.enum([
  "extreme_wide", "wide", "full", "medium", "cowboy", "medium_close", "close", "extreme_close", "insert",
]);
export const CameraAngleSchema = z.enum(["eye_level", "high", "low", "overhead", "dutch"]);
export const CameraMovementSchema = z.enum([
  "static", "pan_left", "pan_right", "tilt_up", "tilt_down",
  "dolly_in", "dolly_out", "truck_left", "truck_right",
  "orbit_left", "orbit_right", "crane_up", "crane_down",
  "drone", "handheld", "zoom_in", "zoom_out", "dolly_zoom",
]);

export const CameraAttrsSchema = z.object({
  scale: ShotScaleSchema,
  angle: CameraAngleSchema,
  movement: CameraMovementSchema,
  speed: z.enum(["slow", "medium", "fast"]).optional(),
  lens: z.union([z.literal(24), z.literal(35), z.literal(50), z.literal(85), z.literal(135)]).optional(),
  depthOfField: z.enum(["deep", "shallow"]).optional(),
});
export type CameraAttrs = z.infer<typeof CameraAttrsSchema>;

export const DEFAULT_CAMERA: CameraAttrs = { scale: "medium", angle: "eye_level", movement: "static" };
