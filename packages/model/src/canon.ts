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
 * A single segment between consecutive projected vertices wider than this spans
 * more than 180 degrees of longitude, which in this dataset only ever means an
 * uncut antimeridian crossing rather than real geometry.
 */
export const MAX_SEGMENT_X = 2.7;
