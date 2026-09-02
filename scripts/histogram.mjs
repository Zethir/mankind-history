#!/usr/bin/env node
// Where does Cliopatria actually have change resolution?
//
// Run this before rendering anything. It tells you where playback will feel
// alive and where it will feel frozen, and it is the targeting map for any
// later hand-authoring work.
//
//   node --max-old-space-size=8192 scripts/histogram.mjs
//   node --max-old-space-size=8192 scripts/histogram.mjs --region=subsaharan
//   node --max-old-space-size=8192 scripts/histogram.mjs --bucket=50 --era=classical

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readFeatureCollection,
  geometryBbox,
  bboxIntersects,
  intervalsOverlap,
  toYear,
} from '../src/lib/geojson.mjs';
import { resolveRegion, resolveEra, REGIONS } from '../src/lib/regions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    region: null, era: 'all', bucket: 100,
    input: 'data/cliopatria.geojson',
    speed: 4,        // the reading speed that felt right in Phase 0
    deadtime: 7,     // D: seconds of nothing before it gets boring
  };
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'bucket' || key === 'speed' || key === 'deadtime') args[key] = Number(value);
    else if (key in args) args[key] = value;
  }
  if (!Number.isFinite(args.bucket) || args.bucket <= 0) {
    throw new Error('--bucket must be a positive number of years');
  }
  return args;
}

/**
 * Two different things get counted here, and the difference is the whole point.
 *
 *   rows          how many polity-versions sit in this bucket
 *   changeYears   how many DISTINCT years anything changes in this bucket
 *
 * Rows measure how much is on screen. Distinct change years measure how often
 * the screen changes. Only the second one produces the feeling of time flowing.
 */
function analyse(features, { bbox, from, to, bucket }) {
  const buckets = new Map();
  const bucketOf = (year) => Math.floor(year / bucket) * bucket;
  const touch = (key) => {
    if (!buckets.has(key)) buckets.set(key, { rows: 0, changeYears: new Set(), polities: new Set() });
    return buckets.get(key);
  };

  let considered = 0;
  let skippedType = 0;
  let skippedYears = 0;
  let skippedGeometry = 0;
  let skippedBbox = 0;
  const durations = [];

  for (const feature of features) {
    const props = feature.properties || {};
    if (String(props.Type || '').toUpperCase() !== 'POLITY') { skippedType++; continue; }

    const fromYear = toYear(props.FromYear);
    const toYearValue = toYear(props.ToYear);
    if (fromYear === null || toYearValue === null) { skippedYears++; continue; }
    if (!intervalsOverlap(fromYear, toYearValue, from, to)) continue;

    const geomBbox = geometryBbox(feature.geometry);
    if (!geomBbox) { skippedGeometry++; continue; }
    if (!bboxIntersects(geomBbox, bbox)) { skippedBbox++; continue; }

    considered++;
    durations.push(toYearValue - fromYear);
    const entry = touch(bucketOf(fromYear));
    entry.rows++;
    entry.changeYears.add(fromYear);
    entry.polities.add(String(props.Name ?? 'unnamed'));
  }

  const rows = [...buckets.entries()]
    .map(([start, v]) => ({
      start,
      rows: v.rows,
      changeYears: v.changeYears.size,
      polities: v.polities.size,
    }))
    .sort((a, b) => a.start - b.start);

  const allChangeYears = [...new Set(
    [...buckets.values()].flatMap((v) => [...v.changeYears])
  )].sort((a, b) => a - b);

  durations.sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : null;

  return {
    rows,
    considered,
    allChangeYears,
    medianDuration: median,
    skipped: { type: skippedType, years: skippedYears, geometry: skippedGeometry, bbox: skippedBbox },
  };
}

/**
 * How much of the timeline would adaptive playback have to accelerate through?
 *
 * Adaptive speed keeps dead time under D seconds by speeding up across gaps.
 * That dissolves the sparse-data problem, but it introduces a new risk worth
 * measuring: if most of the timeline is being fast-forwarded, the product is a
 * skip button with occasional pauses rather than a map of history flowing.
 *
 * At `baseSpeed` years/second, a gap of G years takes G/baseSpeed seconds. Any
 * gap longer than D * baseSpeed years has to be compressed.
 */
function accelerationProfile(changeYearList, from, to, baseSpeed, deadTimeSeconds) {
  const span = to - from;
  if (span <= 0 || changeYearList.length < 2) return null;
  const threshold = deadTimeSeconds * baseSpeed; // years coverable within D seconds
  let acceleratedYears = 0;
  let acceleratedGaps = 0;
  let longestGap = 0;
  const points = [from, ...changeYearList, to];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i] - points[i - 1];
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

function printAcceleration(profile, baseSpeed, deadTimeSeconds) {
  if (!profile) return;
  const pct = (profile.fraction * 100).toFixed(0);
  console.log(
    `  At ${baseSpeed} yr/s with a ${deadTimeSeconds}s dead-time ceiling: ` +
      `${pct}% of the timeline accelerated, ` +
      `${profile.acceleratedGaps}/${profile.totalGaps} gaps compressed.`
  );
  console.log(
    `  Longest silence: ${profile.longestGap} years ` +
      `(${profile.longestGapSeconds.toFixed(0)}s unaccelerated).`
  );
  if (profile.fraction > 0.6) {
    console.log(
      `  Over 60%. At this speed the experience is mostly fast-forward. ` +
        `Either raise the base speed here or accept that this region is a ` +
        `place you jump to rather than play through.`
    );
  }
  console.log('');
}

function formatYear(year) {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function printChart(result, { bucket, label }) {
  const { rows } = result;
  if (!rows.length) {
    console.log(`\n  ${label}: no matching rows.\n`);
    return;
  }
  const max = Math.max(...rows.map((r) => r.changeYears));
  const width = 44;
  const labelWidth = Math.max(...rows.map((r) => formatYear(r.start).length));

  console.log(`\n  ${label} — distinct change years per ${bucket}-year bucket\n`);
  for (const row of rows) {
    const filled = max === 0 ? 0 : Math.round((row.changeYears / max) * width);
    const bar = '█'.repeat(filled).padEnd(width, '·');
    const start = formatYear(row.start).padStart(labelWidth);
    console.log(
      `  ${start}  ${bar}  ${String(row.changeYears).padStart(3)} changes  ` +
        `${String(row.polities).padStart(3)} polities`
    );
  }

  const emptyBuckets = rows.filter((r) => r.changeYears <= 1).length;
  console.log(
    `\n  ${result.considered} version rows, median duration ` +
      `${result.medianDuration} years, ${emptyBuckets}/${rows.length} buckets ` +
      `with 1 or fewer changes.`
  );
  console.log(
    `  Skipped: ${result.skipped.type} non-POLITY, ${result.skipped.years} bad years, ` +
      `${result.skipped.geometry} bad geometry, ${result.skipped.bbox} outside bbox.\n`
  );
}

function main() {
  const args = parseArgs(process.argv);
  const era = resolveEra(args.era);
  const collection = readFeatureCollection(resolve(ROOT, args.input));

  const regionNames = args.region ? [args.region] : Object.keys(REGIONS);
  const output = { era, bucket: args.bucket, regions: {} };

  for (const name of regionNames) {
    const region = resolveRegion(name);
    const result = analyse(collection.features, {
      bbox: region.bbox,
      from: era.from,
      to: era.to,
      bucket: args.bucket,
    });
    printChart(result, {
      bucket: args.bucket,
      label: `${region.label}, ${formatYear(era.from)} to ${formatYear(era.to)}`,
    });
    const profile = accelerationProfile(
      result.allChangeYears, era.from, era.to, args.speed, args.deadtime
    );
    printAcceleration(profile, args.speed, args.deadtime);
    output.regions[name] = { ...result, acceleration: profile };
  }

  const outPath = resolve(ROOT, 'data/histogram.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(output, (k, v) => (v instanceof Set ? [...v] : v), 2)
  );
  console.log(`  Written to data/histogram.json\n`);
}

main();
