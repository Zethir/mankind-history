import type { VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { BASE_SPEED } from "../src/engine/constants";
import { alphaFor, fadeYearsFor } from "../src/engine/fade";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;
const SPEEDS = [1, 2, 4, 8, 16, 64];

describe("fadeYearsFor", () => {
  // Acceptance criterion 6. Decision 0006's own formula clamps to
  // medianVersionDuration / 6 = 1.17 with a lower bound of 1.5 -- inverted
  // bounds, ill-defined. The cap is on EXTENT (toYear - fromYear + 1), not
  // duration: 8.9% of real versions have toYear === fromYear, and a
  // duration-based cap would give those a fade of zero, i.e. a hard cut on a
  // tenth of the dataset, which is what 0001 exists to prevent.
  it("never exceeds half a version's own extent, at any speed", () => {
    for (const r of rows) {
      const extent = r.toYear - r.fromYear + 1;
      for (const speed of SPEEDS) {
        expect(fadeYearsFor(r.fromYear, r.toYear, speed)).toBeLessThanOrEqual(extent / 2);
      }
    }
  });

  it("gives a single-year version a positive fade rather than a hard cut", () => {
    const single = rows.filter((r) => r.toYear === r.fromYear);
    expect(single.length).toBeGreaterThan(0);
    for (const r of single) {
      expect(fadeYearsFor(r.fromYear, r.toYear, BASE_SPEED)).toBeCloseTo(0.5, 10);
    }
  });
});

describe("alphaFor", () => {
  // Acceptance criterion 7. Decision 0001: the polity genuinely existed up to
  // toYear, so no dissolve may begin before toYear + 1. The same argument
  // forbids ramping up before fromYear.
  it("never dissolves before the claim ends, and never appears before it begins", () => {
    for (const r of rows) {
      const fade = fadeYearsFor(r.fromYear, r.toYear, BASE_SPEED);
      const end = r.toYear + 1;
      expect(alphaFor(r.fromYear - 1e-9, r.fromYear, r.toYear, fade)).toBe(0);
      let prev = -1;
      for (let y = r.fromYear; y <= end; y += (end - r.fromYear) / 64 || 1) {
        const a = alphaFor(y, r.fromYear, r.toYear, fade);
        expect(a).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = a;
      }
    }
  });

  // Acceptance criterion 8.
  it("is 0 outside the window, exactly 1 through the hold, monotonic on each ramp", () => {
    const fade = fadeYearsFor(100, 120, BASE_SPEED);
    expect(fade).toBeCloseTo(1.6, 10);
    expect(alphaFor(99, 100, 120, fade)).toBe(0);
    expect(alphaFor(100, 100, 120, fade)).toBe(0);
    expect(alphaFor(100.8, 100, 120, fade)).toBeCloseTo(0.5, 10);
    expect(alphaFor(101.6, 100, 120, fade)).toBe(1);
    expect(alphaFor(110, 100, 120, fade)).toBe(1);
    expect(alphaFor(121, 100, 120, fade)).toBe(1);
    expect(alphaFor(121.8, 100, 120, fade)).toBeCloseTo(0.5, 10);
    expect(alphaFor(122.6, 100, 120, fade)).toBe(0);
    expect(alphaFor(200, 100, 120, fade)).toBe(0);
  });

  it("holds at 1 when the fade width is zero", () => {
    expect(alphaFor(100, 100, 120, 0)).toBe(1);
    expect(alphaFor(121, 100, 120, 0)).toBe(0);
  });
});
