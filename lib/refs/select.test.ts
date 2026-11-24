import { describe, expect, it } from "vitest";
import type { CameraAttrs } from "@/lib/camera/types";
import { scaleGroup, selectReferenceViews, type SelectableRef } from "./select";

const lina: SelectableRef = {
  id: "lina", name: "Lina", tag: "character",
  views: [
    { assetId: "l-front", view: "face_front" },
    { assetId: "l-34", view: "face_34" },
    { assetId: "l-profile", view: "profile" },
    { assetId: "l-body", view: "full_body" },
    { assetId: "l-smile", view: "expression" },
  ],
};
const marc: SelectableRef = {
  id: "marc", name: "Marc", tag: "character",
  views: [
    { assetId: "m-front", view: "face_front" },
    { assetId: "m-34", view: "face_34" },
    { assetId: "m-body", view: "full_body" },
  ],
};
const quai: SelectableRef = {
  id: "quai", name: "Quai", tag: "location",
  views: [
    { assetId: "q-est", view: "establishing" },
    { assetId: "q-a", view: "angle_a" },
    { assetId: "q-b", view: "angle_b" },
  ],
};
const neon: SelectableRef = {
  id: "neon", name: "Néon", tag: "look",
  views: [
    { assetId: "n-mood", view: "mood" },
    { assetId: "n-pal", view: "palette" },
  ],
};
const briquet: SelectableRef = {
  id: "briquet", name: "Briquet", tag: "object",
  views: [
    { assetId: "b-1", view: "detail" },
    { assetId: "b-2", view: "detail" },
  ],
};

const cam = (scale: CameraAttrs["scale"], angle: CameraAttrs["angle"] = "eye_level") => ({ scale, angle });
const ids = (s: ReturnType<typeof selectReferenceViews>) => s.picked.map((p) => p.assetId);

describe("scale groups", () => {
  it("maps every scale of PRD §8 to a group", () => {
    expect(scaleGroup("extreme_close")).toBe("close");
    expect(scaleGroup("close")).toBe("close");
    expect(scaleGroup("medium_close")).toBe("mid");
    expect(scaleGroup("cowboy")).toBe("mid");
    expect(scaleGroup("medium")).toBe("mid");
    expect(scaleGroup("full")).toBe("wide");
    expect(scaleGroup("wide")).toBe("wide");
    expect(scaleGroup("extreme_wide")).toBe("establishing");
    expect(scaleGroup("insert")).toBe("insert");
  });
});

describe("selection per scale (PRD §7 table)", () => {
  it("close-up: face front, 3/4, expression; location only if room is left", () => {
    expect(ids(selectReferenceViews([lina, quai], cam("close"), 3))).toEqual(["l-front", "l-34", "l-smile"]);
    expect(ids(selectReferenceViews([lina, quai], cam("extreme_close"), 4))).toEqual(["l-front", "l-34", "l-smile", "q-est"]);
  });

  it("medium close / cowboy: 3/4 and full body, one location view", () => {
    expect(ids(selectReferenceViews([lina, quai], cam("medium_close"), 4))).toEqual(["l-34", "l-body", "q-est"]);
    expect(ids(selectReferenceViews([lina, quai], cam("cowboy"), 4))).toEqual(["l-34", "l-body", "q-est"]);
  });

  it("medium / wide: full body, establishing + one angle", () => {
    expect(ids(selectReferenceViews([lina, quai], cam("wide"), 4))).toEqual(["l-body", "q-est", "q-a"]);
    expect(ids(selectReferenceViews([lina, quai], cam("full"), 4))).toEqual(["l-body", "q-est", "q-a"]);
  });

  it("establishing shot: location views, characters full body only", () => {
    const s = selectReferenceViews([lina, quai], cam("extreme_wide"), 5);
    expect(ids(s)).toEqual(["l-body", "q-est", "q-a", "q-b"]);
    expect(s.picked.filter((p) => p.tag === "character").map((p) => p.view)).toEqual(["full_body"]);
  });

  it("insert: object details; characters only if room is left", () => {
    expect(ids(selectReferenceViews([briquet, lina], cam("insert"), 2))).toEqual(["b-1", "b-2"]);
    expect(ids(selectReferenceViews([briquet, lina], cam("insert"), 3))).toEqual(["b-1", "b-2", "l-34"]);
  });

  it("close-up and wide shot send different views of the same character", () => {
    const close = selectReferenceViews([lina, quai], cam("close"), 4);
    const wide = selectReferenceViews([lina, quai], cam("wide"), 4);
    expect(close.picked.filter((p) => p.refId === "lina").map((p) => p.view)).toEqual(["face_front", "face_34", "expression"]);
    expect(wide.picked.filter((p) => p.refId === "lina").map((p) => p.view)).toEqual(["full_body"]);
  });
});

describe("slot budget", () => {
  it("characters come first, then object, location, look", () => {
    const s = selectReferenceViews([neon, quai, briquet, lina], cam("medium_close"), 3);
    expect(ids(s)).toEqual(["l-34", "l-body", "b-1"]);
    expect(s.dropped.map((d) => d.assetId)).toEqual(["q-est", "n-mood"]);
  });

  it("shares slots round-robin between characters", () => {
    const s = selectReferenceViews([lina, marc], cam("close"), 3);
    expect(ids(s)).toEqual(["l-front", "m-front", "l-34"]);
  });

  it("look never takes more than one slot", () => {
    const neon2: SelectableRef = { ...neon, id: "neon2", name: "Néon 2" };
    const s = selectReferenceViews([neon, neon2], cam("wide"), 5);
    expect(ids(s)).toEqual(["n-mood"]);
    expect(s.dropped[0].reason).toMatch(/look/);
  });

  it("never exceeds the budget", () => {
    for (const scale of ["close", "medium", "wide", "extreme_wide", "insert"] as const) {
      expect(selectReferenceViews([lina, marc, quai, neon, briquet], cam(scale), 2).picked.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("fallbacks and angle", () => {
  it("uses the closest available view when the preferred ones are missing", () => {
    const onlyBody: SelectableRef = { id: "x", name: "X", tag: "character", views: [{ assetId: "x-body", view: "full_body" }] };
    const s = selectReferenceViews([onlyBody], cam("close"), 3);
    expect(ids(s)).toEqual(["x-body"]);
    expect(s.picked[0].reason).toMatch(/repli/);
  });

  it("low angle favours the 3/4 view over the front view", () => {
    expect(ids(selectReferenceViews([lina], cam("close", "low"), 1))).toEqual(["l-34"]);
    expect(ids(selectReferenceViews([lina], cam("close"), 1))).toEqual(["l-front"]);
  });

  it("ignores refs without images", () => {
    const empty: SelectableRef = { id: "e", name: "E", tag: "character", views: [] };
    expect(selectReferenceViews([empty, quai], cam("wide"), 4).picked.every((p) => p.refId === "quai")).toBe(true);
  });
});
