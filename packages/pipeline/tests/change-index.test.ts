import { COORD_SCALE, GRID, type Version, type VersionGeometry } from "@history/model";
import { describe, expect, it } from "vitest";
import {
  buildChangeIndex,
  nextChangeAfter,
  nextChangeBruteForce,
  polygonBbox,
} from "../src/stages/change-index";

const S = COORD_SCALE.full;

function version(id: string, fromYear: number, toYear: number): Version {
  return {
    id,
    polityId: `name:${id}`,
    fromYear,
    toYear,
    area: 1,
    prevId: null,
    delta: null,
    gap: null,
    confidence: null,
    source: { dataset: "cliopatria", version: "v0.2.0" },
  };
}

/** A square polygon in unscaled projected units, stored as scaled integers. */
function squareAt(x: number, y: number, size: number): VersionGeometry {
  const i = (v: number) => Math.round(v * S);
  return {
    polygons: [
      [[i(x), i(y), i(x + size), i(y), i(x + size), i(y + size), i(x), i(y + size), i(x), i(y)]],
    ],
    bbox: [i(x), i(y), i(x + size), i(y + size)],
    anchor: [i(x + size / 2), i(y + size / 2)],
  };
}

describe("polygonBbox", () => {
  it("bounds a polygon from its own rings, not from the version", () => {
    const g = squareAt(0, 0, 1);
    expect(polygonBbox(g.polygons[0] as number[][])).toEqual([0, 0, S, S]);
  });
});

describe("buildChangeIndex", () => {
  it("produces a row-major grid of the declared size", () => {
    const index = buildChangeIndex([version("a", 0, 10)], { a: squareAt(0, 0, 0.1) }, S);
    expect(index.grid.cols).toBe(GRID.cols);
    expect(index.grid.rows).toBe(GRID.rows);
    expect(index.cells).toHaveLength(GRID.cols * GRID.rows);
  });

  it("records both the start and the end year of every version", () => {
    const index = buildChangeIndex([version("a", -200, 476)], { a: squareAt(0, 0, 0.1) }, S);
    const years = index.cells.flat();
    expect(years).toContain(-200);
    expect(years).toContain(476);
  });

  it("sorts and deduplicates each cell", () => {
    const index = buildChangeIndex(
      [version("a", 100, 200), version("b", 100, 300)],
      { a: squareAt(0, 0, 0.1), b: squareAt(0, 0, 0.1) },
      S,
    );
    for (const cell of index.cells) {
      expect([...cell].sort((x, y) => x - y)).toEqual(cell);
      expect(new Set(cell).size).toBe(cell.length);
    }
    const populated = index.cells.filter((c) => c.length > 0);
    expect(populated[0]).toEqual([100, 200, 300]);
  });

  it("buckets each polygon separately, so a scattered version does not claim the span between its parts", () => {
    // Two small squares far apart. Bucketing the VERSION by its overall bbox
    // would fill every cell between them; bucketing each POLYGON does not.
    const scattered: VersionGeometry = {
      polygons: [
        squareAt(-2.5, -1.2, 0.1).polygons[0] as number[][],
        squareAt(2.4, 1.1, 0.1).polygons[0] as number[][],
      ],
      bbox: [Math.round(-2.5 * S), Math.round(-1.2 * S), Math.round(2.5 * S), Math.round(1.2 * S)],
      anchor: [0, 0],
    };
    const index = buildChangeIndex([version("a", 5, 6)], { a: scattered }, S);
    const populated = index.cells.filter((c) => c.length > 0).length;
    expect(populated).toBeLessThan(10);
  });
});

describe("nextChangeAfter", () => {
  const versions = [version("a", 100, 200), version("b", 900, 1000)];
  const geometry = { a: squareAt(0, 0, 0.2), b: squareAt(0, 0, 0.2) };
  const index = buildChangeIndex(versions, geometry, S);

  it("finds the next change strictly after the given year", () => {
    expect(nextChangeAfter(index, 0, [-0.1, -0.1, 0.3, 0.3])).toBe(100);
    expect(nextChangeAfter(index, 100, [-0.1, -0.1, 0.3, 0.3])).toBe(200);
    expect(nextChangeAfter(index, 200, [-0.1, -0.1, 0.3, 0.3])).toBe(900);
  });

  it("returns null when nothing changes later in that viewport", () => {
    expect(nextChangeAfter(index, 5000, [-0.1, -0.1, 0.3, 0.3])).toBeNull();
  });

  it("ignores changes outside the viewport", () => {
    expect(nextChangeAfter(index, 0, [2.0, 1.0, 2.2, 1.2])).toBeNull();
  });

  it("agrees with a brute-force scan over random queries", () => {
    for (let i = 0; i < 200; i++) {
      const year = Math.round(Math.random() * 1200 - 100);
      const x = Math.random() * 4 - 2;
      const y = Math.random() * 2 - 1;
      const box: [number, number, number, number] = [x, y, x + 0.5, y + 0.5];
      expect(nextChangeAfter(index, year, box)).toBe(
        nextChangeBruteForce(versions, geometry, S, year, box),
      );
    }
  });
});
