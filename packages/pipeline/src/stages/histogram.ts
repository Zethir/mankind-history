import type { ChangesArtifact } from "@history/model";
import { equalEarth } from "@history/model";
import { cellRangeFor } from "./change-index";

/**
 * Equal Earth curves, so projecting the four corners of a lon/lat box is not
 * enough to get its projected extent: the top and bottom edges bow outward.
 * Sample along all four edges instead. Ported from the Phase 0 spike's
 * extract.mjs.
 */
export function projectedBoundsOf(
  bbox: [number, number, number, number],
  samples = 64,
): [number, number, number, number] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const consider = (lon: number, lat: number): void => {
    const [x, y] = equalEarth(lon, lat);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const lon = minLon + (maxLon - minLon) * t;
    const lat = minLat + (maxLat - minLat) * t;
    consider(lon, minLat);
    consider(lon, maxLat);
    consider(minLon, lat);
    consider(maxLon, lat);
  }
  return [minX, minY, maxX, maxY];
}

/** One tally: how many distinct change years fall in this bucket. */
export interface HistogramBucket {
  start: number;
  changeYears: number;
}

/**
 * How much of the timeline would adaptive playback have to accelerate
 * through? Adaptive speed (decision 0006) keeps dead time under a ceiling by
 * speeding up across gaps. That dissolves the sparse-data problem, but it
 * introduces a new risk worth measuring: if most of the timeline is being
 * fast-forwarded, the product is a skip button with occasional pauses rather
 * than a map of history flowing.
 *
 * At `baseSpeed` years per second, a gap of G years takes G/baseSpeed
 * seconds. Any gap longer than `deadTimeSeconds * baseSpeed` years has to be
 * compressed, and it contributes `gap - threshold` accelerated years.
 */
export interface AccelerationProfile {
  fraction: number;
  acceleratedGaps: number;
  totalGaps: number;
  longestGap: number;
  longestGapSeconds: number;
  thresholdYears: number;
}

export function accelerationProfile(
  changeYears: number[],
  from: number,
  to: number,
  baseSpeed: number,
  deadTimeSeconds: number,
): AccelerationProfile | null {
  const span = to - from;
  // One change year is profilable: `from -> y` and `y -> to` are two
  // well-defined gaps, and a lone change in a long window is exactly the case
  // adaptive playback exists for. Zero change years genuinely has nothing to
  // profile -- there is no gap structure, only the window itself.
  if (span <= 0 || changeYears.length === 0) return null;

  const threshold = deadTimeSeconds * baseSpeed;
  let acceleratedYears = 0;
  let acceleratedGaps = 0;
  let longestGap = 0;
  const points = [from, ...changeYears, to];
  for (let i = 1; i < points.length; i++) {
    const gap = (points[i] as number) - (points[i - 1] as number);
    if (gap > longestGap) longestGap = gap;
    if (gap > threshold) {
      acceleratedGaps++;
      acceleratedYears += gap - threshold;
    }
  }

  return {
    fraction: acceleratedYears / span,
    acceleratedGaps,
    totalGaps: points.length - 1,
    longestGap,
    longestGapSeconds: longestGap / baseSpeed,
    thresholdYears: threshold,
  };
}

export interface HistogramResult {
  buckets: HistogramBucket[];
  allChangeYears: number[];
  acceleration: AccelerationProfile | null;
}

/**
 * Converts the lon/lat bbox to projected space, collects the distinct change
 * years from every grid cell it overlaps, buckets them, and profiles how much
 * of the timeline adaptive playback would accelerate through.
 */
export function analyse(
  changes: ChangesArtifact,
  bbox: [number, number, number, number],
  from: number,
  to: number,
  bucket: number,
  speed: number,
  deadtime: number,
): HistogramResult {
  const projected = projectedBoundsOf(bbox);
  const { x0, x1, y0, y1 } = cellRangeFor(changes.grid, projected);

  const distinctYears = new Set<number>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = changes.cells[y * changes.grid.cols + x];
      if (!cell) continue;
      for (const year of cell) {
        if (year >= from && year <= to) distinctYears.add(year);
      }
    }
  }

  const allChangeYears = [...distinctYears].sort((a, b) => a - b);

  const bucketOf = (year: number): number => Math.floor(year / bucket) * bucket;
  const bucketYears = new Map<number, Set<number>>();
  for (const year of allChangeYears) {
    const key = bucketOf(year);
    let set = bucketYears.get(key);
    if (!set) {
      set = new Set<number>();
      bucketYears.set(key, set);
    }
    set.add(year);
  }

  const buckets: HistogramBucket[] = [...bucketYears.entries()]
    .map(([start, years]) => ({ start, changeYears: years.size }))
    .sort((a, b) => a.start - b.start);

  const acceleration = accelerationProfile(allChangeYears, from, to, speed, deadtime);

  return { buckets, allChangeYears, acceleration };
}
