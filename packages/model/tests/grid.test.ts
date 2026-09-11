import { describe, expect, it } from "vitest";
import { cellRangeFor, GRID, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "../src/index";

const grid = {
  cols: GRID.cols,
  rows: GRID.rows,
  bounds: [-WORLD_HALF_WIDTH, -WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, WORLD_HALF_HEIGHT] as [
    number,
    number,
    number,
    number,
  ],
};

describe("cellRangeFor", () => {
  it("covers every cell for a bbox spanning the world", () => {
    const r = cellRangeFor(grid, grid.bounds);
    expect(r).toEqual({ x0: 0, x1: GRID.cols - 1, y0: 0, y1: GRID.rows - 1 });
  });

  it("clamps a bbox reaching outside the world instead of going negative", () => {
    const r = cellRangeFor(grid, [-99, -99, 99, 99]);
    expect(r).toEqual({ x0: 0, x1: GRID.cols - 1, y0: 0, y1: GRID.rows - 1 });
  });

  it("maps the origin to a middle cell, not a corner", () => {
    const r = cellRangeFor(grid, [0, 0, 0, 0]);
    expect(r.x0).toBe(GRID.cols / 2);
    expect(r.y0).toBe(GRID.rows / 2);
  });

  it("uses the grid it is given rather than the module constants", () => {
    // A released artifact keeps the grid it was built with. Reading GRID while
    // indexing the artifact's own cells would silently read the wrong cells the
    // moment the constant changes.
    const tiny = { cols: 4, rows: 2, bounds: grid.bounds };
    const r = cellRangeFor(tiny, grid.bounds);
    expect(r).toEqual({ x0: 0, x1: 3, y0: 0, y1: 1 });
  });
});
