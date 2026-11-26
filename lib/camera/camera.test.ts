import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/lib/prompt/build";
import { MOVEMENT_LABEL, SCALE_LABEL } from "./labels";
import { GENERIC_PHRASES, cameraPhrase, keyframeCameraPhrase, supportsMovement, videoCameraPhrase } from "./phrasing";
import { CameraMovementSchema, ShotScaleSchema, type CameraAttrs } from "./types";

const base: CameraAttrs = { scale: "close", angle: "eye_level", movement: "static" };

describe("camera vocabulary", () => {
  it("has a French label and a generic phrase for every value", () => {
    for (const s of ShotScaleSchema.options) {
      expect(SCALE_LABEL[s]).toBeTruthy();
      expect(GENERIC_PHRASES[`scale.${s}`]).toBeTruthy();
    }
    for (const m of CameraMovementSchema.options) {
      expect(MOVEMENT_LABEL[m]).toBeTruthy();
      expect(GENERIC_PHRASES[`movement.${m}`]).toBeTruthy();
    }
  });
});

describe("keyframe vs video wording (PRD §8: where it acts)", () => {
  it("keyframe uses scale, angle, lens, depth of field — never the movement", () => {
    const p = keyframeCameraPhrase({ ...base, angle: "low", lens: 85, depthOfField: "shallow", movement: "dolly_in" });
    expect(p).toBe("close-up shot, low-angle shot looking up at the subject, 85mm portrait lens, shallow depth of field, softly blurred background");
    expect(p).not.toMatch(/dolly/);
  });

  it("eye level is implicit", () => {
    expect(keyframeCameraPhrase(base)).toBe("close-up shot");
  });

  it("video uses movement and speed — never the scale", () => {
    const p = videoCameraPhrase({ ...base, movement: "dolly_in", speed: "slow" });
    expect(p).toBe("the camera dollies in toward the subject, slow and smooth");
    expect(cameraPhrase("video", { ...base, movement: "static", speed: "fast" })).toBe("static camera, locked-off shot");
  });

  it("changing scale or movement changes the wording", () => {
    expect(cameraPhrase("keyframe", { ...base, scale: "wide" })).not.toBe(cameraPhrase("keyframe", base));
    expect(cameraPhrase("video", { ...base, movement: "pan_left" })).not.toBe(cameraPhrase("video", base));
  });
});

describe("per-model overrides and capabilities", () => {
  it("uses the model's wording when it has one", () => {
    const caps = { phrases: { "movement.dolly_zoom": "vertigo effect" } as const };
    expect(videoCameraPhrase({ ...base, movement: "dolly_zoom" }, caps)).toBe("vertigo effect");
    expect(videoCameraPhrase({ ...base, movement: "dolly_in" }, caps)).toBe(GENERIC_PHRASES["movement.dolly_in"]);
  });

  it("flags movements a model cannot do; static is always fine; undocumented = allowed", () => {
    const caps = { movements: ["pan_left", "dolly_in"] as CameraAttrs["movement"][] };
    expect(supportsMovement(caps, "dolly_in")).toBe(true);
    expect(supportsMovement(caps, "orbit_left")).toBe(false);
    expect(supportsMovement(caps, "static")).toBe(true);
    expect(supportsMovement(undefined, "drone")).toBe(true);
  });
});

describe("PromptBuilder", () => {
  it("orders descriptors, action, camera, look and keeps descriptors verbatim", () => {
    const d = "Femme de 30 ans, cheveux noirs courts, manteau rouge";
    const { prompt, parts } = buildPrompt({
      descriptors: [{ name: "Lina", descriptor: d }],
      action: "Lina attend sur le quai",
      camera: "close-up shot",
      looks: [{ name: "Néon", descriptor: "Néons magenta, brume" }],
    });
    expect(parts.map((p) => p.kind)).toEqual(["descriptor", "action", "camera", "look"]);
    expect(prompt).toBe(`${d}. Lina attend sur le quai. Close-up shot. Néons magenta, brume.`);
  });

  it("skips empty parts", () => {
    expect(buildPrompt({ descriptors: [{ name: "X", descriptor: " " }], action: "", camera: "wide shot" }).prompt).toBe("Wide shot.");
  });
});
