import { describe, expect, it } from "vitest";
import { resolveEra, resolveRegion } from "../src/regions";
import { accelerationProfile, projectedBoundsOf } from "../src/stages/histogram";

describe("projectedBoundsOf", () => {
  it("samples along the edges, because Equal Earth curves", () => {
    // Projecting only the four corners understates a wide box's extent: the
    // top and bottom edges bow. A sampled bound must be at least as wide as a
    // corners-only one.
    const sampled = projectedBoundsOf([-180, -90, 180, 90]);
    expect(sampled[2] - sampled[0]).toBeGreaterThan(5.4);
    expect(sampled[3] - sampled[1]).toBeGreaterThan(2.6);
  });

  it("bounds a small box tightly", () => {
    const b = projectedBoundsOf([0, 0, 1, 1]);
    expect(b[2] - b[0]).toBeLessThan(0.05);
  });
});

describe("accelerationProfile", () => {
  it("reports nothing accelerated when changes are denser than the ceiling", () => {
    const years = [0, 10, 20, 30, 40];
    const p = accelerationProfile(years, 0, 40, 4, 7);
    expect(p?.fraction).toBe(0);
  });

  it("counts only the years beyond what D seconds covers", () => {
    // At 4 years/second with a 7-second ceiling, 28 years are coverable; a
    // 128-year gap therefore contributes 100 accelerated years.
    const p = accelerationProfile([0, 128], 0, 128, 4, 7);
    expect(p?.acceleratedGaps).toBe(1);
    expect(p?.fraction).toBeCloseTo(100 / 128, 6);
  });

  it("returns null when there is nothing to profile", () => {
    // Zero change years genuinely has no gap structure to profile -- only the
    // window itself. One change year does: see the case below.
    expect(accelerationProfile([], 0, 100, 4, 7)).toBeNull();
  });

  it("profiles a single change year, which is two gaps and not nothing", () => {
    // from -> y and y -> to are both well defined. At 4 yr/s with a 7s
    // ceiling, 28 years are coverable: the 50-year gap either side of year 50
    // contributes 22 accelerated years each, 44 of a 100-year span.
    const p = accelerationProfile([50], 0, 100, 4, 7);
    expect(p).not.toBeNull();
    expect(p?.totalGaps).toBe(2);
    expect(p?.acceleratedGaps).toBe(2);
    expect(p?.longestGap).toBe(50);
    expect(p?.fraction).toBeCloseTo(44 / 100, 6);
  });
});

describe("resolveRegion / resolveEra", () => {
  it("returns the Phase 0 bounding boxes unchanged, so results stay comparable", () => {
    expect(resolveRegion("mediterranean").bbox).toEqual([-10, 25, 45, 50]);
    expect(resolveEra("classical")).toMatchObject({ from: -200, to: 500 });
  });

  it("names the known keys when given an unknown one", () => {
    expect(() => resolveRegion("atlantis")).toThrow(/mediterranean/);
  });
});
