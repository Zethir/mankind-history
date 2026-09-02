#!/usr/bin/env node
// Slice Cliopatria to a region and era, project to Equal Earth, emit a compact
// file the renderer can load without any parsing work.
//
//   node --max-old-space-size=8192 scripts/extract.mjs
//   node --max-old-space-size=8192 scripts/extract.mjs --region=subsaharan --out=data/slice-control.json
//
// Deliberately NOT clipping geometry to the bounding box. Clipping invents
// borders that never existed, which is exactly the failure mode this whole
// project is trying to avoid. Polygons that extend past the viewport simply
// get cropped visually at draw time.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readFeatureCollection,
  geometryBbox,
  bboxIntersects,
  intervalsOverlap,
  toYear,
} from '../src/lib/geojson.mjs';
import { equalEarth } from '../src/lib/projection.mjs';
import { resolveRegion, resolveEra } from '../src/lib/regions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    region: 'mediterranean',
    era: 'classical',
    input: 'data/cliopatria.geojson',
    out: 'data/slice.json',
    precision: 4,
  };
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) continue;
    const [, key, value] = match;
    if (key === 'precision') args.precision = Number(value);
    else if (key in args) args[key] = value;
  }
  return args;
}

/** Project a ring of [lon, lat] pairs into a flat [x0,y0,x1,y1,...] array. */
function projectRing(ring, round) {
  const flat = new Array(ring.length * 2);
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = equalEarth(ring[i][0], ring[i][1]);
    flat[i * 2] = round(x);
    flat[i * 2 + 1] = round(y);
  }
  return flat;
}

/** Normalise Polygon and MultiPolygon into a single list of projected polygons. */
function projectGeometry(geometry, round) {
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const out = [];
  for (const rings of polygons) {
    const projected = rings
      .map((ring) => projectRing(ring, round))
      .filter((flat) => flat.length >= 6); // a ring needs 3 points to enclose area
    if (projected.length) out.push(projected);
  }
  return out;
}

/**
 * Equal Earth curves, so projecting the four corners of a lon/lat box is not
 * enough to get its projected extent. Sample along the edges instead.
 */
function projectedBoundsOf(bbox, samples = 64) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (lon, lat) => {
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

function medianOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function main() {
  const args = parseArgs(process.argv);
  const region = resolveRegion(args.region);
  const era = resolveEra(args.era);
  const factor = 10 ** args.precision;
  const round = (n) => Math.round(n * factor) / factor;

  const collection = readFeatureCollection(resolve(ROOT, args.input));

  const polityIndex = new Map();
  const polities = [];
  const versions = [];
  let skipped = 0;

  for (const feature of collection.features) {
    const props = feature.properties || {};
    if (String(props.Type || '').toUpperCase() !== 'POLITY') { skipped++; continue; }

    const from = toYear(props.FromYear);
    const to = toYear(props.ToYear);
    if (from === null || to === null) { skipped++; continue; }
    if (!intervalsOverlap(from, to, era.from, era.to)) continue;

    const geomBbox = geometryBbox(feature.geometry);
    if (!geomBbox || !bboxIntersects(geomBbox, region.bbox)) { skipped++; continue; }

    const polys = projectGeometry(feature.geometry, round);
    if (!polys.length) { skipped++; continue; }

    const name = String(props.Name ?? 'unnamed');
    if (!polityIndex.has(name)) {
      polityIndex.set(name, polities.length);
      polities.push({
        name,
        wikidata: props.Wikidata ?? null,
        wikipedia: props.Wikipedia ?? null,
        seshat: props.SeshatID ?? null,
      });
    }

    versions.push({
      p: polityIndex.get(name),
      from,
      to,
      area: Number(props.Area) || 0,
      prevArea: null,
      delta: null,
      gap: null,
      polys,
    });
  }

  // Lineage. Cliopatria stores each version independently, with no link to the
  // same polity's previous state, so the renderer cannot tell growth from
  // shrinkage. Derive it here, once, at build time.
  //
  //   prevArea  the same polity's area in its previous version
  //   delta     signed area change; null on first appearance
  //   gap       years of silence since the previous version ended
  //
  // `gap` is what keeps the expansion flash honest. A version arriving after a
  // long hole represents accumulated drift rather than an event, and the
  // renderer refuses to dramatise it.
  const byPolity = new Map();
  for (const v of versions) {
    if (!byPolity.has(v.p)) byPolity.set(v.p, []);
    byPolity.get(v.p).push(v);
  }
  for (const list of byPolity.values()) {
    list.sort((a, b) => a.from - b.from || a.to - b.to);
    let prev = null;
    for (const v of list) {
      if (prev) {
        v.prevArea = prev.area;
        v.delta = v.area - prev.area;
        v.gap = Math.max(0, v.from - prev.to);
      } else {
        v.prevArea = null;
        v.delta = null;
        v.gap = null;
      }
      prev = v;
    }
  }

  // Draw order: largest first, so smaller polities land on top of the empires
  // that contain them. Sorted once here, never per frame.
  versions.sort((a, b) => b.area - a.area);

  const payload = {
    meta: {
      generated: new Date().toISOString(),
      source: args.input,
      region: { key: args.region, label: region.label, bbox: region.bbox },
      era: { key: args.era, label: era.label, from: era.from, to: era.to },
      projection: 'equal-earth',
      projectedBounds: projectedBoundsOf(region.bbox).map(round),
      counts: { polities: polities.length, versions: versions.length, skipped },
      medianDuration: medianOf(versions.map((v) => v.to - v.from)),
      medianGap: medianOf(versions.filter((v) => v.gap !== null).map((v) => v.gap)),
    },
    polities,
    versions,
  };

  const outPath = resolve(ROOT, args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload));

  const kb = (statSync(outPath).size / 1024).toFixed(1);
  console.log(
    `\n  ${region.label}, ${era.label}: ${polities.length} polities, ` +
      `${versions.length} versions, ${skipped} skipped`
  );
  console.log(
    `  Median version duration ${payload.meta.medianDuration} years, ` +
      `median gap ${payload.meta.medianGap} years`
  );
  console.log(
    `  Suggested MAX_FADE_YEARS: ${Math.max(4, Math.round(payload.meta.medianDuration / 6))} ` +
      `(a fade wider than this shows three states of one polity at once)`
  );
  console.log(`  Written to ${args.out} (${kb} KB)\n`);

  if (versions.length === 0) {
    console.log('  Nothing matched. Check the region bbox and era bounds.\n');
  } else if (versions.length > 4000) {
    console.log(
      '  That is a lot of versions for a canvas spike. Simplify harder or ' +
        'narrow the era before judging performance.\n'
    );
  }
}

main();
