import { join } from "node:path";
import type { LevelName, VersionsArtifact } from "@history/model";
import { COORD_SCALE } from "@history/model";
import { readArtifact } from "@history/model/artifact";

/**
 * Retained-vertex spacing per detail level, measured directly on the built
 * geometry.
 *
 * Task 1's border-displacement measurement (displacement.ts) does not
 * discriminate between coarse and mid: p99 is 0.002932 units at BOTH levels,
 * because only seven arcs are displaced at all and they are the same seven
 * arcs at every level -- a seven-member distribution puts every percentile
 * above p50 on one index. What differs between levels is not how far a
 * retained vertex moves (mapshaper only drops vertices, never relocates
 * them -- enforced in displacement.ts) but how far apart the *retained*
 * vertices are, since a level that keeps fewer of them leaves longer straight
 * segments standing in for what was a curve.
 *
 * This measures exactly that: for every ring in every version's geometry at a
 * level, the Euclidean distance between each pair of consecutive vertices,
 * in projected world units (COORD_SCALE.<level>-descaled, not screen pixels
 * -- pixel conversion depends on a viewport scale the caller chooses).
 *
 * **What this established (Task 6, against the real dist/, via `pnpm
 * spacing`):** rendered segment length at fit scale --
 *
 *   coarse: p50 1.352px | p90 3.282px | p99 6.651px | max 89.395px
 *   mid:    p50 1.193px | p90 2.863px | p99 6.003px | max 89.397px
 *   full:   p50 1.003px | p90 2.612px | p99 5.686px | max 89.397px
 *
 * The three levels differ by at most 35% at any percentile, and their
 * maxima are identical (the same genuinely-straight source border at every
 * level, not a simplification artifact). Coarse keeps 30% of full's
 * vertices yet its typical segment is only a third longer -- simplification
 * is working as intended, but the consequence is that **the levels are a
 * bandwidth difference, not a fidelity one.** A visible-jaggedness threshold
 * a zoom level could cross does not exist in this data: there is no scale at
 * which one level looks meaningfully worse than its neighbour.
 *
 * The project owner's conclusion: drop zoom-based level *switching*
 * entirely. There is no threshold to switch on. The viewer instead loads
 * coarse and paints it, then upgrades to mid and then full as they arrive,
 * strictly one-directionally -- see `packages/viewer/src/render/level.ts`
 * (`DetailLevel`) and docs/phase-2-milestone-2-design.md, "Thresholds: what
 * the measurement actually showed". This measurement
 * stays in the repo because it is the evidence for that decision, not
 * because a threshold still needs it.
 */

const LEVEL_FILE: Record<LevelName, string> = {
  coarse: "versions.0.json",
  mid: "versions.1.json",
  full: "versions.2.json",
};

export interface SpacingReport {
  ringsConsidered: number;
  /** Ascending, in projected units: one entry per consecutive-vertex gap. */
  spacings: number[];
}

/**
 * Measures the distance between consecutive retained vertices along every
 * ring of every version's geometry, at the given level, from artifacts in
 * `distDir`.
 */
export function measureSpacing(distDir: string, level: LevelName): SpacingReport {
  const artifact = readArtifact<VersionsArtifact>(join(distDir, LEVEL_FILE[level]));
  const scale = COORD_SCALE[level];

  let ringsConsidered = 0;
  const spacings: number[] = [];

  for (const geometry of Object.values(artifact.geometry)) {
    for (const polygon of geometry.polygons) {
      for (const ring of polygon) {
        // Fewer than two points has no segment to measure.
        if (ring.length < 4) continue;
        ringsConsidered++;
        for (let i = 0; i + 3 < ring.length; i += 2) {
          const dx = ((ring[i + 2] as number) - (ring[i] as number)) / scale;
          const dy = ((ring[i + 3] as number) - (ring[i + 1] as number)) / scale;
          spacings.push(Math.hypot(dx, dy));
        }
      }
    }
  }

  spacings.sort((a, b) => a - b);

  return { ringsConsidered, spacings };
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] as number;
}
