/**
 * Which detail artifact is currently on screen for the political layer.
 * Detail only ever improves -- coarse paints first, mid and full replace it
 * silently as their own fetches resolve (see `data/levels.ts`). There is no
 * zoom-to-level mapping; see docs/decisions/0020-percentile-displacement.md
 * and docs/phase-2-milestone-2-design.md, "Thresholds: what the measurement
 * actually showed".
 */
export type DetailLevel = "coarse" | "mid" | "full";
