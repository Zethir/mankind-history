import type { PolitiesArtifact, VersionsArtifact } from "@history/model";
import { COORD_SCALE, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { colourFor } from "../src/render/palette";
import { fitWorld, fromScreen, toScreen } from "../src/render/transform";

describe("transform", () => {
  const view = fitWorld(1400, 700);

  it("centres the projected world in the canvas", () => {
    const [cx, cy] = toScreen(view, 0, 0, COORD_SCALE.coarse);
    expect(cx).toBeCloseTo(700, 6);
    expect(cy).toBeCloseTo(350, 6);
  });

  it("fits the whole world inside the canvas", () => {
    const s = COORD_SCALE.coarse;
    const corners: Array<[number, number]> = [
      [-WORLD_HALF_WIDTH * s, -WORLD_HALF_HEIGHT * s],
      [WORLD_HALF_WIDTH * s, WORLD_HALF_HEIGHT * s],
    ];
    for (const [x, y] of corners) {
      const [sx, sy] = toScreen(view, x, y, s);
      expect(sx).toBeGreaterThanOrEqual(-1e-6);
      expect(sx).toBeLessThanOrEqual(1400 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeLessThanOrEqual(700 + 1e-6);
    }
  });

  it("puts north at the top", () => {
    const s = COORD_SCALE.coarse;
    const [, north] = toScreen(view, 0, s, s);
    const [, south] = toScreen(view, 0, -s, s);
    expect(north).toBeLessThan(south);
  });

  // Pins fitWorld's scale to the exact intended minimum, computed from the
  // model constants (not a hardcoded number) so this survives a constants
  // change but still fails a spurious factor error such as scaling by
  // WORLD_HALF_WIDTH * 4 instead of * 2.
  it("picks the exact minimum scale that fits both dimensions", () => {
    const expected = Math.min(1400 / (WORLD_HALF_WIDTH * 2), 700 / (WORLD_HALF_HEIGHT * 2));
    expect(view.scale).toBeCloseTo(expected, 9);
  });

  // A 1400x700 canvas against a world 2.054:1 wide is width-bound: the fitted
  // world's left/right edges must touch the canvas edges, not merely fall
  // short of overflowing them. Containment alone (the previous test) would
  // pass even if the scale were silently halved.
  it("touches the left and right edges when width-bound", () => {
    const s = COORD_SCALE.coarse;
    const [left] = toScreen(view, -WORLD_HALF_WIDTH * s, 0, s);
    const [right] = toScreen(view, WORLD_HALF_WIDTH * s, 0, s);
    expect(left).toBeCloseTo(0, 6);
    expect(right).toBeCloseTo(1400, 6);
  });

  // Same check in the other orientation, so the Math.min in fitWorld is
  // pinned on both branches: a canvas short enough to be height-bound must
  // have its top/bottom edges touch, which a width-bound-only test can't see.
  it("touches the top and bottom edges when height-bound", () => {
    const shortView = fitWorld(1400, 400);
    const s = COORD_SCALE.coarse;
    const [, top] = toScreen(shortView, 0, WORLD_HALF_HEIGHT * s, s);
    const [, bottom] = toScreen(shortView, 0, -WORLD_HALF_HEIGHT * s, s);
    expect(top).toBeCloseTo(0, 6);
    expect(bottom).toBeCloseTo(400, 6);
  });

  // Acceptance criterion 16.
  it("round-trips a coordinate to within one pixel", () => {
    const s = COORD_SCALE.coarse;
    const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
    let checked = 0;
    for (const g of Object.values(versions.geometry)) {
      for (const poly of g.polygons) {
        for (const ring of poly) {
          for (let i = 0; i + 1 < ring.length; i += 2) {
            const x = ring[i] as number;
            const y = ring[i + 1] as number;
            const [sx, sy] = toScreen(view, x, y, s);
            const [bx, by] = fromScreen(view, sx, sy, s);
            const [rx, ry] = toScreen(view, bx, by, s);
            expect(Math.abs(rx - sx)).toBeLessThan(1);
            expect(Math.abs(ry - sy)).toBeLessThan(1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("palette", () => {
  // Acceptance criterion 17. Colour must be stable per polity: crossfading
  // between two versions of one polity while its colour shifts would read as
  // one entity being replaced by another -- exactly the false assertion
  // decision 0001 exists to avoid.
  it("gives a polity the same colour every time it is asked", () => {
    const polities = readArtifact<PolitiesArtifact>("fixtures/dist/polities.json").polities;
    for (const p of polities) {
      expect(colourFor(p.id)).toBe(colourFor(p.id));
    }
  });

  it("gives every version of one polity the same colour", () => {
    const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
    const byPolity = new Map<string, Set<string>>();
    for (const r of versions.rows) {
      const seen = byPolity.get(r.polityId) ?? new Set<string>();
      seen.add(colourFor(r.polityId));
      byPolity.set(r.polityId, seen);
    }
    for (const [polityId, colours] of byPolity) {
      expect(colours.size, polityId).toBe(1);
    }
  });

  it("produces a valid colour string for every polity", () => {
    const polities = readArtifact<PolitiesArtifact>("fixtures/dist/polities.json").polities;
    for (const p of polities) {
      expect(colourFor(p.id)).toMatch(/^hsl\(\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%\)$/);
    }
  });
});
