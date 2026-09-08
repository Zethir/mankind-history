import type { VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { BASE_SPEED } from "../src/engine/constants";
import { Timeline } from "../src/engine/timeline";

const artifact = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
const timeline = new Timeline(artifact);

describe("Timeline", () => {
  it("reports the range spanned by its rows", () => {
    const lo = Math.min(...artifact.rows.map((r) => r.fromYear));
    const hi = Math.max(...artifact.rows.map((r) => r.toYear));
    expect(timeline.range).toEqual([lo, hi]);
  });

  // Acceptance criterion 13. The oracle is the RAW CLAIM INTERVAL, which the
  // fade logic never consults -- deliberately not a brute-force rescan, which
  // would be vacuous here because the implementation is itself a linear scan.
  // Milestone 2 of Phase 1 shipped a vacuous test of exactly that shape.
  //
  // Note the half-open interval: at y === fromYear a version is at the very
  // start of its fade-in and so at alpha 0, which is correct.
  it("returns every version whose claim contains the year, at positive alpha", () => {
    for (const r of artifact.rows) {
      for (const y of [r.fromYear + 1e-6, (r.fromYear + r.toYear + 1) / 2, r.toYear + 1]) {
        const hit = timeline.activeAt(y, BASE_SPEED).find((d) => d.versionId === r.id);
        expect(hit, `${r.id} missing at year ${y}`).toBeDefined();
        expect((hit as { alpha: number }).alpha).toBeGreaterThan(0);
      }
    }
  });

  it("never returns an alpha outside (0, 1]", () => {
    const [lo, hi] = timeline.range;
    for (let y = lo; y <= hi + 2; y += 7.5) {
      for (const d of timeline.activeAt(y, BASE_SPEED)) {
        expect(d.alpha).toBeGreaterThan(0);
        expect(d.alpha).toBeLessThanOrEqual(1);
        expect(d.flash).toBeGreaterThanOrEqual(0);
        expect(d.flash).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns nothing before the first claim or long after the last", () => {
    const [lo, hi] = timeline.range;
    expect(timeline.activeAt(lo - 1, BASE_SPEED)).toHaveLength(0);
    expect(timeline.activeAt(hi + 100, BASE_SPEED)).toHaveLength(0);
  });

  it("suppresses the flash wherever flashStrengthFor does", () => {
    const suppressed = new Set(
      artifact.rows.filter((r) => r.prevId === null || (r.gap ?? 0) > 50).map((r) => r.id),
    );
    const [lo, hi] = timeline.range;
    for (let y = lo; y <= hi; y += 11.5) {
      for (const d of timeline.activeAt(y, BASE_SPEED)) {
        if (suppressed.has(d.versionId)) expect(d.flash).toBe(0);
      }
    }
  });
});
