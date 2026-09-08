import type { Version, VersionsArtifact } from "@history/model";
import { alphaFor, fadeYearsFor } from "./fade";
import { flashEnvelope, flashStrengthFor } from "./flash";
import type { Draw } from "./frame";

/**
 * Turns a fractional year into the set of versions to draw.
 *
 * A linear scan over every row, every frame. Measured: the worst year in the
 * real dataset has 195 active versions and under 20,000 vertices on screen, so
 * 13,380 comparisons per frame is not worth indexing away -- and the scan
 * behaves identically under playback, scrubbing and jumping, with no cursor to
 * invalidate. See docs/phase-2-milestone-1-design.md.
 */
export class Timeline {
  private readonly rows: readonly Version[];
  /** Parallel to `rows`. Constant per version, so hoisted out of the frame loop. */
  private readonly strength: readonly number[];
  readonly range: readonly [number, number];

  constructor(artifact: VersionsArtifact) {
    this.rows = artifact.rows;
    this.strength = artifact.rows.map(flashStrengthFor);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const r of artifact.rows) {
      if (r.fromYear < lo) lo = r.fromYear;
      if (r.toYear > hi) hi = r.toYear;
    }
    this.range = [lo, hi];
  }

  activeAt(year: number, speed: number): Draw[] {
    const draws: Draw[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i] as Version;
      const fade = fadeYearsFor(r.fromYear, r.toYear, speed);
      const alpha = alphaFor(year, r.fromYear, r.toYear, fade);
      if (alpha <= 0) continue;
      const s = this.strength[i] as number;
      draws.push({
        versionId: r.id,
        alpha,
        flash: s > 0 ? s * flashEnvelope(year, r.fromYear, fade) : 0,
      });
    }
    return draws;
  }
}
