import {
  type ChangesArtifact,
  cellRangeFor,
  GRID,
  type Polygon,
  SCHEMA_VERSION,
  type Version,
  type VersionGeometry,
  WORLD_HALF_HEIGHT,
  WORLD_HALF_WIDTH,
} from "@history/model";

const BOUNDS: [number, number, number, number] = [
  -WORLD_HALF_WIDTH,
  -WORLD_HALF_HEIGHT,
  WORLD_HALF_WIDTH,
  WORLD_HALF_HEIGHT,
];

/** Bounding box of one polygon, in the same scaled integers as its rings. */
export function polygonBbox(polygon: Polygon): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i] as number;
      const y = ring[i + 1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** The grid the build writes into the artifact, for the one caller that predates it. */
const BUILD_GRID: ChangesArtifact["grid"] = { cols: GRID.cols, rows: GRID.rows, bounds: BOUNDS };

/**
 * Build the change-year index.
 *
 * Each POLYGON is bucketed by its own bounding box rather than the version's.
 * Measured on the real dataset, a single version's bbox can claim 72% of the
 * map while its individual polygons claim 10% -- see
 * docs/decisions/0013-index-buckets-polygons.md.
 *
 * A polygon's bounding box is still not the polygon, so a query can report a
 * change just outside the visible shape. That is a documented property: the
 * failure mode is a brief pause for something slightly off-screen, which shows
 * more than necessary rather than skipping something real.
 */
export function buildChangeIndex(
  versions: Version[],
  geometry: Record<string, VersionGeometry>,
  coordScale: number,
): ChangesArtifact {
  const cells: Array<Set<number>> = Array.from(
    { length: GRID.cols * GRID.rows },
    () => new Set<number>(),
  );

  for (const version of versions) {
    const g = geometry[version.id];
    if (!g) continue;
    for (const polygon of g.polygons) {
      const bb = polygonBbox(polygon);
      const { x0, x1, y0, y1 } = cellRangeFor(BUILD_GRID, [
        bb[0] / coordScale,
        bb[1] / coordScale,
        bb[2] / coordScale,
        bb[3] / coordScale,
      ]);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cell = cells[y * GRID.cols + x] as Set<number>;
          cell.add(version.fromYear);
          // A fade-out begins the year AFTER the claim ends, so toYear + 1 is
          // the moment the view changes. Bucketing toYear records a year
          // nothing happens at, and makes a transition look like two events
          // a year apart.
          cell.add(version.toYear + 1);
        }
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    grid: BUILD_GRID,
    cells: cells.map((set) => [...set].sort((a, b) => a - b)),
  };
}

/**
 * The query backing decision 0006's nextVisibleChange. `bbox` is in unscaled
 * projected units.
 */
export function nextChangeAfter(
  index: ChangesArtifact,
  year: number,
  bbox: [number, number, number, number],
): number | null {
  const { x0, x1, y0, y1 } = cellRangeFor(index.grid, bbox);
  let best: number | null = null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = index.cells[y * index.grid.cols + x];
      if (!cell) continue;
      for (const candidate of cell) {
        if (candidate <= year) continue;
        if (best === null || candidate < best) best = candidate;
        break; // cells are sorted, so the first year past `year` is the best here
      }
    }
  }
  return best;
}

/**
 * The same question answered by scanning every polygon. Exists so the
 * acceptance criterion can compare the two. It must use the SAME
 * polygon-bounding-box predicate as the index -- and therefore the same grid,
 * which is why the caller passes the artifact's own -- or the comparison would
 * be testing the predicate rather than the index.
 */
export function nextChangeBruteForce(
  grid: ChangesArtifact["grid"],
  versions: Version[],
  geometry: Record<string, VersionGeometry>,
  coordScale: number,
  year: number,
  bbox: [number, number, number, number],
): number | null {
  const { x0, x1, y0, y1 } = cellRangeFor(grid, bbox);
  let best: number | null = null;
  for (const version of versions) {
    const g = geometry[version.id];
    if (!g) continue;
    let overlaps = false;
    for (const polygon of g.polygons) {
      const bb = polygonBbox(polygon);
      const r = cellRangeFor(grid, [
        bb[0] / coordScale,
        bb[1] / coordScale,
        bb[2] / coordScale,
        bb[3] / coordScale,
      ]);
      if (r.x0 <= x1 && r.x1 >= x0 && r.y0 <= y1 && r.y1 >= y0) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) continue;
    for (const candidate of [version.fromYear, version.toYear + 1]) {
      if (candidate > year && (best === null || candidate < best)) best = candidate;
    }
  }
  return best;
}
