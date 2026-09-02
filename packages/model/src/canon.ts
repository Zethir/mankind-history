/** Every constant shared between the pipeline and the viewer. One place. */

export const SCHEMA_VERSION = 1;

export const PROJECTION = "equal-earth" as const;

/**
 * Coordinates are stored as `Math.round(projected * scale)`. Integer storage
 * makes precision explicit and determinism true by construction rather than by
 * careful float rounding.
 *
 * `full` is 1e8 because the acceptance criteria require un-projecting a stored
 * coordinate to return the source lon/lat within 1e-6 degrees. The Equal Earth
 * longitude gradient is about 68 degrees per projected unit, so a 1e-8 quantum
 * contributes at most ~3.4e-7 degrees of error — inside the bound with margin.
 */
export const COORD_SCALE = {
  coarse: 1e5,
  mid: 1e6,
  full: 1e8,
} as const;

/** Artifact file suffix per detail level: versions.0.json is coarse. */
export const LEVEL_INDEX = {
  coarse: 0,
  mid: 1,
  full: 2,
} as const;

/** Half the projected world width: x at lon 180, lat 0. */
export const WORLD_HALF_WIDTH = 2.7062;

/**
 * A single segment between consecutive projected vertices wider than this spans
 * more than 180 degrees of longitude, which in this dataset only ever means an
 * uncut antimeridian crossing rather than real geometry.
 */
export const MAX_SEGMENT_X = 2.7;
