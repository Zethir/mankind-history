/**
 * Every playback tunable, in one place. All provisional until the Milestone 1
 * feel session -- see docs/phase-2-milestone-1-design.md.
 */

/** Years per second at reading speed. Phase 0 settled on 4. */
export const BASE_SPEED = 4;

/** Wall-clock fade duration. Constant across speeds, per decision 0006. */
export const FADE_SECONDS = 0.4;

/**
 * Auto mode aims to cover the distance to the next change in this many
 * seconds, floored at BASE_SPEED. Dead time grows only logarithmically in gap
 * size: this dataset's largest gap, 300 years, closes in 7.58 s.
 */
export const APPROACH_SECONDS = 1.5;

/** Smoothing time constant for acceleration only. Deceleration is immediate. */
export const TAU = 0.3;

/** Selectable speeds, in years per second. Auto is a separate mode. */
export const SPEED_STEPS = [1, 2, 4, 8, 16] as const;
