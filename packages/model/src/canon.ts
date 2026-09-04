/** Every constant shared between the pipeline and the viewer. One place. */

export const SCHEMA_VERSION = 1;

export const PROJECTION = "equal-earth" as const;

/**
 * Coordinates are stored as `Math.round(projected * scale)`. Integer storage
 * makes precision explicit and determinism true by construction rather than by
 * careful float rounding.
 *
 * `full` is 1e9 because the acceptance criteria require un-projecting a stored
 * coordinate to return the source lon/lat within 1e-6 degrees. The binding
 * error is not the direct longitude gradient but the error in the recovered
 * parametric latitude, which propagates into both coordinates and is worst at
 * high latitude and at the map's eastern and western edges. Measured worst
 * case over |lat| <= 89, sweeping latitude in 0.02-degree steps: 7.9e-6
 * degrees at 1e8 (fails), 1.4e-6 at 5e8 (fails), 6.8e-7 at 1e9 (passes). 1e9
 * is therefore near the minimum that survives fine sampling, not a generous
 * margin. Exactly at the poles no finite scale suffices -- see the projection
 * tests.
 */
export const COORD_SCALE = {
  coarse: 1e5,
  mid: 1e6,
  full: 1e9,
} as const;

/** Artifact file suffix per detail level: versions.0.json is coarse. */
export const LEVEL_INDEX = {
  coarse: 0,
  mid: 1,
  full: 2,
} as const;

/** Half the projected world width: x at lon 180, lat 0. */
export const WORLD_HALF_WIDTH = 2.70663;

/**
 * A single segment between consecutive projected vertices wider than this is
 * an uncut antimeridian crossing rather than real geometry. Two measured
 * bounds set it: a correct pole seam (Antarctica's ring stepping from lon 180
 * to lon -180 along lat -90, left uncut -- see
 * docs/decisions/0012-antimeridian-cutting.md) projects to 3.2072 units at its
 * widest, while a genuine uncut crossing spans nearly the full map width,
 * about 5.4 units. 4.0 sits above the former and well below the latter.
 */
export const MAX_SEGMENT_X = 4.0;

/** Half the projected world height: y at lat 90. */
export const WORLD_HALF_HEIGHT = 1.31736;

/**
 * Change-index grid, uniform over projected space. Because the projection is
 * equal-area, uniform cells mean uniform real area per cell rather than uniform
 * degrees.
 *
 * 64x32 measured at 33 KB gzipped over the real dataset, against 9 KB for
 * 24x12 -- the index is negligible at every resolution tried, so this is chosen
 * for query precision rather than size. See
 * docs/decisions/0013-index-buckets-polygons.md.
 */
export const GRID = { cols: 64, rows: 32 } as const;

/**
 * PROVISIONAL. Screen pixels per projected unit at the coarsest zoom each level
 * is expected to serve, used only by the no-new-gaps acceptance criterion.
 *
 * These encode a Phase 2 viewport assumption that does not exist yet: a
 * 1400-pixel-wide window showing the whole world at coarse, an eighth of it at
 * mid, and a sixty-fourth at full. The projected world is 5.4133 units wide.
 * Phase 2 should replace these with the viewer's real figures.
 */
export const PX_PER_UNIT = {
  coarse: 259,
  mid: 2069,
  full: 16552,
} as const;

/**
 * Visvalingam vertex-retention percentage per level, passed to mapshaper.
 *
 * Chosen by measurement, not by feel: see the table in the Milestone 2 plan.
 * The rule is the LEAST aggressive simplification that meets the budget, since
 * the 8 MB gzipped ceiling applies only to the coarsest artifact and fidelity
 * matters more than bytes here. `full` is 100 because it is not simplified.
 *
 * Measured on the full real dataset (13,380 versions, 3,422,830 vertices,
 * dist/versions.2.json), one mapshaper call per level over every version,
 * rescaled to each level's COORD_SCALE and serialised exactly as emit.ts
 * would. Percent -> vertices retained / resulting versions.0.json gzip size:
 *   0 -> 60.8% / 2.50 MB    10 -> 63.4% / 2.58 MB    30 -> 70.1% / 3.02 MB
 *  50 -> 78.6% / 3.53 MB    70 -> 87.4% / 4.27 MB   100 -> 100.0% / 6.21 MB
 * The 8 MB budget does not bind anywhere in this range -- even 100 (no
 * simplification at all) fits, because it is coarse's 1e5 coordinate scale,
 * not its vertex count, that does most of the size reduction from full's
 * 1e9. `coarse` is 30: the least aggressive value in the brief's tested
 * candidate range [1, 2, 5, 10, 20, 30], giving real simplification
 * appropriate for a global zoomed-out view (see PX_PER_UNIT.coarse) while
 * leaving 62% headroom under the ceiling for future dataset growth. `mid` is
 * 60: of the values measured, the one closest to the vertex count midway
 * between coarse and full (2,834,596 against a target of 2,911,520).
 *
 * A retention curve attributed earlier to this dataset (0 -> 43.8%,
 * 10 -> 48.8%, ...) in fact measured only the first 2,000 of its 13,380
 * versions -- confirmed by reproducing that subset's exact vertex counts
 * (964,929 in, 473,856 out at 10%). The full dataset retains substantially
 * more at every percentage: it holds proportionally more small, already
 * near-minimal shapes that cannot lose many vertices. See the Task 4 report
 * for the full measured table, including sizes at every tested percentage.
 */
export const SIMPLIFY_PERCENT = {
  coarse: 30,
  mid: 60,
  full: 100,
} as const;
