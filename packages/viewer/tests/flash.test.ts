import type { Version, VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { flashEnvelope, flashStrengthFor } from "../src/engine/flash";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;

function version(over: Partial<Version>): Version {
  return {
    id: "name:X@100",
    polityId: "name:X",
    fromYear: 100,
    toYear: 120,
    area: 150,
    prevId: "name:X@80",
    delta: 50,
    gap: 20,
    confidence: null,
    source: { dataset: "cliopatria", version: "test" },
    ...over,
  };
}

describe("flashStrengthFor", () => {
  // Acceptance criterion 9. Decision 0004: a first appearance is often the
  // atlas beginning to cover a region, not a polity coming into being.
  it("is silent on a first appearance", () => {
    expect(flashStrengthFor(version({ prevId: null, delta: null, gap: null }))).toBe(0);
    const real = rows.filter((r) => r.prevId === null);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);

    // The pipeline (lineage.ts) never emits prevId: null alongside a non-null
    // delta -- a first appearance always has delta: null too, which means the
    // case above cannot tell the prevId guard apart from the delta guard: if
    // the prevId check in flash.ts were deleted, the delta === null check
    // would independently zero out every one of those same rows and this
    // test would keep passing. This case forces prevId: null with a non-null
    // delta and gap -- a state real data never produces -- specifically to
    // isolate the prevId guard. Do not delete it as "unreachable": it is the
    // only assertion that would notice if that guard were removed.
    expect(flashStrengthFor(version({ prevId: null, delta: 50, gap: 10 }))).toBe(0);
  });

  // Acceptance criterion 10. A gap that long is not attributable to a datable
  // event -- it is centuries of drift between two atlas samples.
  it("is silent when the gap since the previous version exceeds 50 years", () => {
    expect(flashStrengthFor(version({ gap: 51 }))).toBe(0);
    expect(flashStrengthFor(version({ gap: 50 }))).toBeGreaterThan(0);
    const real = rows.filter((r) => (r.gap ?? 0) > 50);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);
  });

  // Acceptance criterion 11. Contraction fades without a flash.
  it("is silent on a zero or negative delta", () => {
    expect(flashStrengthFor(version({ delta: 0 }))).toBe(0);
    expect(flashStrengthFor(version({ delta: -20 }))).toBe(0);
    const real = rows.filter((r) => r.prevId !== null && (r.delta ?? 0) <= 0);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);
  });

  // Acceptance criterion 12. Strength scales with RELATIVE change, so a small
  // polity doubling reads as strongly as an empire gaining a few percent.
  it("reaches full strength at +50% relative area and is monotonic below it", () => {
    // prevArea = area - delta. 100 -> 150 is +50%.
    expect(flashStrengthFor(version({ area: 150, delta: 50 }))).toBeCloseTo(1, 10);
    expect(flashStrengthFor(version({ area: 300, delta: 200 }))).toBe(1);
    expect(flashStrengthFor(version({ area: 125, delta: 25 }))).toBeCloseTo(0.5, 10);
    expect(flashStrengthFor(version({ area: 110, delta: 10 }))).toBeCloseTo(0.2, 10);

    const small = flashStrengthFor(version({ area: 2, delta: 1 })); // 1 -> 2, +100%
    const large = flashStrengthFor(version({ area: 1_100_000, delta: 100_000 })); // +10%
    expect(small).toBe(1);
    expect(large).toBeCloseTo(0.2, 10);
  });

  it("is between 0 and 1 for every version in the fixture", () => {
    for (const r of rows) {
      const s = flashStrengthFor(r);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("flashEnvelope", () => {
  it("peaks as the version reaches full opacity and is gone afterwards", () => {
    expect(flashEnvelope(100, 100, 1.6)).toBe(0);
    expect(flashEnvelope(101.6, 100, 1.6)).toBeCloseTo(1, 10);
    // Midway through the decay (decay width = fadeYears * 2 = 3.2), the
    // envelope should read 0.5. This point sits strictly between the ramp
    // peak (1.6) and the true cutoff (4.8), so it pins the "twice the fade
    // width" decay coefficient: a decay of fadeYears * 1.2 would read ~0.167
    // here instead, and a decay of fadeYears * 1 would already be at cutoff
    // and read 0. The endpoint samples below cannot tell those apart.
    expect(flashEnvelope(103.2, 100, 1.6)).toBeCloseTo(0.5, 10);
    expect(flashEnvelope(104.8, 100, 1.6)).toBeCloseTo(0, 10);
    expect(flashEnvelope(110, 100, 1.6)).toBe(0);
    expect(flashEnvelope(99, 100, 1.6)).toBe(0);
  });

  it("is silent when there is no fade to ride", () => {
    expect(flashEnvelope(100, 100, 0)).toBe(0);
  });
});
