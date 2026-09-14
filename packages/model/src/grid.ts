import type { ChangesArtifact } from "./types";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Inclusive cell range covering an unscaled-projected bbox, against a grid
 * passed in rather than against the module constants.
 *
 * Every query takes its grid from the artifact it is querying. `changes.json`
 * carries `grid` precisely so a consumer can use the file standalone, and a
 * released artifact keeps the grid it was built with: reading the shape from
 * `GRID` while indexing `cells` by the artifact's own `cols` would silently
 * read the wrong cells the moment the constant is changed, here or in a Phase 2
 * viewer querying a previously released file. Only `buildChangeIndex` uses the
 * constants, because there the artifact does not exist yet.
 */
export function cellRangeFor(
  grid: ChangesArtifact["grid"],
  bbox: [number, number, number, number],
) {
  const [minX, minY, maxX, maxY] = grid.bounds;
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    x0: clamp(Math.floor(((bbox[0] - minX) / w) * grid.cols), 0, grid.cols - 1),
    x1: clamp(Math.floor(((bbox[2] - minX) / w) * grid.cols), 0, grid.cols - 1),
    y0: clamp(Math.floor(((bbox[1] - minY) / h) * grid.rows), 0, grid.rows - 1),
    y1: clamp(Math.floor(((bbox[3] - minY) / h) * grid.rows), 0, grid.rows - 1),
  };
}
