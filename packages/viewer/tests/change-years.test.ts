import type { ChangesArtifact, VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { ChangeYears } from "../src/engine/change-years";

const changes = readArtifact<ChangesArtifact>("fixtures/dist/changes.json");
const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("ChangeYears", () => {
  const cy = new ChangeYears(changes);
  const WORLD = changes.grid.bounds as [number, number, number, number];

  // Acceptance criterion 10.
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

  // Acceptance criterion 11. The two implementations must agree where their
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
});
