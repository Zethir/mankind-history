import type { ChangesArtifact, VersionsArtifact } from "@history/model";
import { cellRangeFor } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { ChangeYears } from "../src/engine/change-years";

const changes = readArtifact<ChangesArtifact>("fixtures/dist/changes.json");
const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("ChangeYears", () => {
  const cy = new ChangeYears(changes);
  const WORLD = changes.grid.bounds as [number, number, number, number];

  // Acceptance criterion 8.
  it("returns the smallest event year strictly greater than the query", () => {
    let year = -10_000;
    for (let i = 0; i < 50; i++) {
      const next = cy.nextChangeAfter(year, WORLD);
      if (next === null) break;
      expect(next).toBeGreaterThan(year);
      year = next;
    }
  });

  it("returns null past the last event", () => {
    expect(cy.nextChangeAfter(1e9, WORLD)).toBeNull();
  });

  // Acceptance criterion 9. The two implementations must agree where their
  // domains overlap -- a world bbox is exactly Milestone 1's question.
  it("agrees with the row-derived sequence for a world-wide bbox", () => {
    const fromRows = [...new Set(versions.rows.flatMap((r) => [r.fromYear, r.toYear + 1]))].sort(
      (a, b) => a - b,
    );
    const fromIndex: number[] = [];
    let year = Number.NEGATIVE_INFINITY;
    for (;;) {
      const next = cy.nextChangeAfter(year, WORLD);
      if (next === null) break;
      fromIndex.push(next);
      year = next;
    }
    expect(fromIndex).toEqual(fromRows);
  });

  it("returns fewer events for a small bbox than for the world", () => {
    const [minX, minY, maxX, maxY] = WORLD;
    const tiny: [number, number, number, number] = [
      minX + (maxX - minX) * 0.5,
      minY + (maxY - minY) * 0.5,
      minX + (maxX - minX) * 0.52,
      minY + (maxY - minY) * 0.52,
    ];
    const count = (bbox: [number, number, number, number] | null) => {
      let n = 0;
      let year = Number.NEGATIVE_INFINITY;
      for (;;) {
        const next = cy.nextChangeAfter(year, bbox);
        if (next === null) return n;
        n++;
        year = next;
      }
    };
    expect(count(tiny)).toBeLessThan(count(WORLD));
  });

  it("treats a null bbox as the whole world", () => {
    expect(cy.nextChangeAfter(-10_000, null)).toBe(cy.nextChangeAfter(-10_000, WORLD));
  });

  // Regression test for an off-by-one a reviewer found by inspection: mutating
  // the loop's `x <= x1` to `x < x1` (dropping the last column of every
  // viewport) still passed the rest of this suite, because the only small-bbox
  // test above spans two cells that happen to both be empty. This bbox is
  // chosen against the real fixture (fixtures/dist/changes.json) so that
  // BOTH the range's last column and its last row are load-bearing:
  // cellRangeFor(changes.grid, bbox) resolves to x0=30, x1=31, y0=23, y1=24,
  // and only the single corner cell (31, 24) -- the last column AND the last
  // row of that range -- carries the years 536/540/546/555. Every other cell
  // in the range (30,23), (31,23), (30,24) carries only [407, 410, 414, 455,
  // 458]. So querying just past 458 only finds 536 if the loop visits both
  // the last column and the last row; dropping either one independently
  // loses the corner cell and the answer silently becomes null.
  it("visits the last column and last row of its cell range, not just up to them", () => {
    const bbox: [number, number, number, number] = [-0.15, 0.6, -0.05, 0.7];
    expect(cellRangeFor(changes.grid, bbox)).toEqual({ x0: 30, x1: 31, y0: 23, y1: 24 });
    expect(cy.nextChangeAfter(458, bbox)).toBe(536);
  });
});
