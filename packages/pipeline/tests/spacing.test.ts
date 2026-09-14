import { describe, expect, it } from "vitest";
import { measureSpacing, percentile } from "../src/stages/spacing";

const FIXTURES = "fixtures/dist";

describe("measureSpacing", () => {
  it("reports rings and spacings for the fixture at every level", () => {
    for (const level of ["coarse", "mid", "full"] as const) {
      const r = measureSpacing(FIXTURES, level);
      expect(r.ringsConsidered).toBeGreaterThan(0);
      for (const d of r.spacings) expect(d).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns spacings sorted ascending, so percentiles are index lookups", () => {
    const r = measureSpacing(FIXTURES, "coarse");
    for (let i = 1; i < r.spacings.length; i++) {
      expect(r.spacings[i] as number).toBeGreaterThanOrEqual(r.spacings[i - 1] as number);
    }
  });

  it("has fewer segments at coarse than at full: fewer retained vertices, fewer gaps", () => {
    // Coarse retains fewer vertices than full, so a ring's points are spread
    // across the same border with fewer of them -- fewer segments, and each
    // one typically longer. Not a statistical claim about the fixture's
    // percentiles, just about vertex count.
    const coarse = measureSpacing(FIXTURES, "coarse");
    const full = measureSpacing(FIXTURES, "full");
    // Strict: on the fixture these are 8,155 against 20,497, over 2x apart,
    // so equality would itself be a sign this measurement broke.
    expect(coarse.spacings.length).toBeLessThan(full.spacings.length);
  });
});

describe("percentile", () => {
  it("returns 0 for an empty distribution", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("indexes into a sorted array at the given fraction", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 0.5)).toBe(6);
    expect(percentile(sorted, 0.99)).toBe(10);
  });
});
