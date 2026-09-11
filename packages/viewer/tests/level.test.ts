import { describe, expect, it } from "vitest";
import { HYSTERESIS, LEVEL_THRESHOLDS, landLevelFor, selectLevel } from "../src/render/level";

const FIT = 258.6;

describe("selectLevel", () => {
  // Acceptance criterion 5.
  it("picks the level each threshold assigns", () => {
    expect(selectLevel(FIT, FIT, "coarse")).toBe("coarse");
    expect(selectLevel(FIT * LEVEL_THRESHOLDS.mid, FIT, "coarse")).toBe("mid");
    expect(selectLevel(FIT * LEVEL_THRESHOLDS.full, FIT, "mid")).toBe("full");
  });

  // Acceptance criterion 6. Without hysteresis, nudging the wheel across the
  // boundary triggers a 12 MB fetch and nudging back triggers another.
  it("does not switch back until well below the threshold", () => {
    const justOver = FIT * LEVEL_THRESHOLDS.mid * 1.01;
    expect(selectLevel(justOver, FIT, "coarse")).toBe("mid");
    const justUnder = FIT * LEVEL_THRESHOLDS.mid * 0.99;
    expect(selectLevel(justUnder, FIT, "mid")).toBe("mid");
    const wellUnder = FIT * LEVEL_THRESHOLDS.mid * HYSTERESIS * 0.99;
    expect(selectLevel(wellUnder, FIT, "mid")).toBe("coarse");
  });

  it("is stable: re-selecting at the same scale never oscillates", () => {
    let level: ReturnType<typeof selectLevel> = "coarse";
    for (const scale of [FIT, FIT * 3, FIT * 3, FIT * 20, FIT * 20, FIT * 3, FIT]) {
      const next = selectLevel(scale, FIT, level);
      expect(selectLevel(scale, FIT, next)).toBe(next);
      level = next;
    }
  });
});

describe("landLevelFor", () => {
  // Acceptance criterion 7. The pipeline emits land.0 and land.1 only.
  it("saturates at mid, because there is no land.2", () => {
    expect(landLevelFor("coarse")).toBe("coarse");
    expect(landLevelFor("mid")).toBe("mid");
    expect(landLevelFor("full")).toBe("mid");
  });
});
