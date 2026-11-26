import type { CameraAttrs } from "./types";

/**
 * Generic English wording per camera value (standard film vocabulary), used
 * in prompts unless a model overrides it (PRD §8).
 *
 * Where it acts: scale, angle, lens and depth of field shape the keyframe;
 * movement and speed shape the animation.
 */

export type CameraKey =
  | `scale.${CameraAttrs["scale"]}`
  | `angle.${CameraAttrs["angle"]}`
  | `movement.${CameraAttrs["movement"]}`
  | `speed.${NonNullable<CameraAttrs["speed"]>}`
  | `lens.${NonNullable<CameraAttrs["lens"]>}`
  | `dof.${NonNullable<CameraAttrs["depthOfField"]>}`;

export const GENERIC_PHRASES: Record<CameraKey, string> = {
  "scale.extreme_wide": "extreme wide shot, the subject small in a vast environment",
  "scale.wide": "wide shot",
  "scale.full": "full shot, subject visible from head to toe",
  "scale.medium": "medium shot, framed from the waist up",
  "scale.cowboy": "cowboy shot, framed from mid-thigh up",
  "scale.medium_close": "medium close-up, framed from the chest up",
  "scale.close": "close-up shot",
  "scale.extreme_close": "extreme close-up on a detail",
  "scale.insert": "insert shot, tight detail of an object",

  "angle.eye_level": "eye-level camera",
  "angle.high": "high-angle shot looking down on the subject",
  "angle.low": "low-angle shot looking up at the subject",
  "angle.overhead": "overhead top-down shot",
  "angle.dutch": "dutch angle with a tilted horizon",

  "movement.static": "static camera, locked-off shot",
  "movement.pan_left": "the camera pans left",
  "movement.pan_right": "the camera pans right",
  "movement.tilt_up": "the camera tilts up",
  "movement.tilt_down": "the camera tilts down",
  "movement.dolly_in": "the camera dollies in toward the subject",
  "movement.dolly_out": "the camera dollies out away from the subject",
  "movement.truck_left": "the camera trucks left in a lateral tracking shot",
  "movement.truck_right": "the camera trucks right in a lateral tracking shot",
  "movement.orbit_left": "the camera orbits around the subject to the left",
  "movement.orbit_right": "the camera orbits around the subject to the right",
  "movement.crane_up": "crane shot, the camera rises up",
  "movement.crane_down": "crane shot, the camera descends",
  "movement.drone": "aerial drone shot flying over the scene",
  "movement.handheld": "handheld camera with natural shake",
  "movement.zoom_in": "the lens zooms in",
  "movement.zoom_out": "the lens zooms out",
  "movement.dolly_zoom": "dolly zoom, the background stretches while the subject keeps its size",

  "speed.slow": "slow and smooth",
  "speed.medium": "at a steady pace",
  "speed.fast": "fast and dynamic",

  "lens.24": "24mm wide-angle lens",
  "lens.35": "35mm lens",
  "lens.50": "50mm lens, natural perspective",
  "lens.85": "85mm portrait lens",
  "lens.135": "135mm telephoto lens, compressed background",

  "dof.deep": "deep focus, everything sharp",
  "dof.shallow": "shallow depth of field, softly blurred background",
};

/** What a model can say about camera control (lives on its registry entry). */
export interface CameraCapabilities {
  /** Movements the model handles reliably. Undefined = not documented: all allowed. */
  movements?: CameraAttrs["movement"][];
  /** Better wording for this model, per value. */
  phrases?: Partial<Record<CameraKey, string>>;
}

export type CameraStage = "keyframe" | "video";

function phrase(key: CameraKey, caps?: CameraCapabilities): string {
  return caps?.phrases?.[key] ?? GENERIC_PHRASES[key];
}

/** Keyframe wording: scale, angle, lens, depth of field. */
export function keyframeCameraPhrase(attrs: CameraAttrs, caps?: CameraCapabilities): string {
  const parts = [phrase(`scale.${attrs.scale}`, caps)];
  if (attrs.angle !== "eye_level") parts.push(phrase(`angle.${attrs.angle}`, caps));
  if (attrs.lens) parts.push(phrase(`lens.${attrs.lens}`, caps));
  if (attrs.depthOfField) parts.push(phrase(`dof.${attrs.depthOfField}`, caps));
  return parts.join(", ");
}

/** Animation wording: movement and speed (speed is meaningless when static). */
export function videoCameraPhrase(attrs: CameraAttrs, caps?: CameraCapabilities): string {
  const move = phrase(`movement.${attrs.movement}`, caps);
  if (attrs.movement === "static" || !attrs.speed) return move;
  return `${move}, ${phrase(`speed.${attrs.speed}`, caps)}`;
}

export function cameraPhrase(stage: CameraStage, attrs: CameraAttrs, caps?: CameraCapabilities): string {
  return stage === "video" ? videoCameraPhrase(attrs, caps) : keyframeCameraPhrase(attrs, caps);
}

export function supportsMovement(caps: CameraCapabilities | undefined, movement: CameraAttrs["movement"]): boolean {
  if (movement === "static") return true;
  return !caps?.movements || caps.movements.includes(movement);
}
