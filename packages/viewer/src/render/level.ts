/** Which detail artifact to draw at a given zoom. */
export type DetailLevel = "coarse" | "mid" | "full";

/**
 * Multiples of fit scale (the px-per-projected-unit at which the whole world
 * fits the window) at which each level's own simplification becomes visible
 * enough to justify the next level's fetch.
 *
 * Task 1's per-arc border-displacement measurement (packages/pipeline/src/
 * stages/displacement.ts) cannot set these: against the real dist/, p99
 * displacement is 0.002932 units at BOTH coarse and mid (`pnpm displacement`),
 * because only seven arcs are displaced at all and they are the same seven
 * arcs at every level -- a seven-member distribution puts every percentile
 * above p50 on one index. Simplification on this dataset does not move
 * borders, it removes vertices from them.
 *
 * What discriminates instead is retained-vertex spacing: how far apart the
 * points a level DID keep are, since a level that dropped more of them leaves
 * longer straight segments standing in for what was a curve. Measured with
 * `pnpm spacing` (packages/pipeline/src/stages/spacing.ts), against the real
 * dist/, as the distance between consecutive retained vertices along every
 * ring of every version's geometry, in projected units converted to pixels
 * at fit scale (258.6 px/unit):
 *
 *   coarse: 2,331,183 segments | p50 1.352px | p90 3.282px | p99 6.651px
 *   mid:    2,745,581 segments | p50 1.193px | p90 2.863px | p99 6.003px
 *   full:   3,312,907 segments | p50 1.003px | p90 2.612px | p99 5.686px
 *
 * p90 and p99 are contaminated by segments that are long for reasons that
 * have nothing to do with simplification -- genuinely straight borders
 * already present in the source data -- evidenced by the top end barely
 * moving between levels at all (max 0.345690 units at coarse vs 0.345696 at
 * full, a 0.002% difference, against a p50 that moves 35%). p50 is therefore
 * the "typical" spacing this constant is built from, not an outlier
 * percentile that mostly restates a property of the underlying geometry.
 *
 * A retained-vertex spacing of a few screen pixels is where a polyline
 * stops reading as a curve and starts reading as a broken line (2-4px is the
 * range where the human eye starts resolving the individual facets); this
 * picks the middle of that range, 3px, as the visibility target. Each
 * threshold is then the zoom multiplier at which the level being LEFT
 * reaches that target: `3 / (p50_px_at_fit_scale)`, evaluated per level:
 *
 *   mid:  3 / 1.352 = 2.22 -- leaving coarse (its own facets become visible)
 *   full: 3 / 1.193 = 2.51 -- leaving mid
 *
 * The gap between these two is real, not a rounding accident: it is fixed by
 * the ratio of coarse's to mid's p50 (1.352 / 1.193 = 1.13) and does not
 * change with the pixel target chosen above. A 13% zoom range for "mid" is
 * narrow; see task-6-report.md for that concern.
 */
export const LEVEL_THRESHOLDS: { mid: number; full: number } = {
  mid: 2.22,
  full: 2.51,
};

/**
 * Moving up a level (more detail) fires exactly at its threshold. Moving
 * down fires only once the scale falls below `threshold * HYSTERESIS`, so a
 * scale that lingers near a boundary does not flip back and forth -- each
 * flip is a fetch (up to 12 MB for the full level) that a jittering wheel
 * event must not repeat.
 */
export const HYSTERESIS = 0.8;

/**
 * Picks the detail level for `scale` (px per projected unit), given the
 * window's fit-to-window scale and the level currently drawn.
 *
 * Thresholds are evaluated outer level first (full, then mid) so a scale
 * that qualifies for full is never short-circuited into mid, and downward
 * moves compare against `threshold * HYSTERESIS` so hovering near a boundary
 * cannot oscillate.
 */
export function selectLevel(scale: number, fitScale: number, current: DetailLevel): DetailLevel {
  const ratio = scale / fitScale;

  if (ratio >= LEVEL_THRESHOLDS.full) return "full";
  if (current === "full" && ratio >= LEVEL_THRESHOLDS.full * HYSTERESIS) return "full";

  if (ratio >= LEVEL_THRESHOLDS.mid) return "mid";
  if (current !== "coarse" && ratio >= LEVEL_THRESHOLDS.mid * HYSTERESIS) return "mid";

  return "coarse";
}

/**
 * The pipeline emits `land.0` (coarse) and `land.1` (mid) only -- there is no
 * `land.2` -- so the land layer saturates at mid regardless of how detailed
 * the political layer gets.
 */
export function landLevelFor(level: DetailLevel): "coarse" | "mid" {
  return level === "coarse" ? "coarse" : "mid";
}
