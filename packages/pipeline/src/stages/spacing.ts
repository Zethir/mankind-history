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
