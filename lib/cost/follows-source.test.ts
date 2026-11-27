import { describe, expect, it } from "vitest";
import { followsSourceLength } from "./estimate";

describe("video edit length", () => {
  it("a video edit without a duration input is billed on the source's length", () => {
    expect(followsSourceLength({ kind: "v2v" })).toBe(true);
    expect(followsSourceLength({ kind: "v2v", supportsDuration: true })).toBe(false);
    expect(followsSourceLength({ kind: "v2v", durations: [5, 10] })).toBe(false);
    expect(followsSourceLength({ kind: "i2v" })).toBe(false);
    // Seedance 2.5: duration -1 follows the input video
    expect(followsSourceLength({ kind: "r2v", durations: [4, 5], supportsDuration: true, autoDuration: true })).toBe(true);
  });
});
