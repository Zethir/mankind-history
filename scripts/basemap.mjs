#!/usr/bin/env node
// Project Natural Earth land polygons into the same Equal Earth space as the
// territory slices, so the renderer can draw them with one shared transform.
//
// Natural Earth is public domain, so it adds no licensing constraint on top of
// Cliopatria's CC-BY. Download the GeoJSON from the natural-earth-vector repo:
//
//   data/ne_110m_land.geojson   good for the whole globe
//   data/ne_50m_land.geojson    better for a regional view like the Mediterranean
//
//   node scripts/basemap.mjs --input=data/ne_50m_land.geojson --out=data/land.json
//
// The coastline is modern. Over the range this project covers that is
// defensible almost everywhere, but not silently: the Aral Sea, the Dutch
// coast and the head of the Persian Gulf have all moved enough to matter, and
// the UI says so once rather than pretending otherwise.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFeatureCollection } from '../src/lib/geojson.mjs';
import { equalEarth } from '../src/lib/projection.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { input: 'data/ne_110m_land.geojson', out: 'data/land.json', precision: 4 };
  for (const arg of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (!m) continue;
    if (m[1] === 'precision') args.precision = Number(m[2]);
    else if (m[1] in args) args[m[1]] = m[2];
  }
  return args;
}

const args = parseArgs(process.argv);
const factor = 10 ** args.precision;
const round = (n) => Math.round(n * factor) / factor;

const collection = readFeatureCollection(resolve(ROOT, args.input));
const polys = [];

for (const feature of collection.features) {
  const g = feature.geometry;
  if (!g) continue;
  const groups =
    g.type === 'Polygon' ? [g.coordinates] :
    g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const rings of groups) {
    const projected = [];
    for (const ring of rings) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      const flat = new Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = equalEarth(ring[i][0], ring[i][1]);
        flat[i * 2] = round(x);
        flat[i * 2 + 1] = round(y);
      }
      projected.push(flat);
    }
    if (projected.length) polys.push(projected);
  }
}

const outPath = resolve(ROOT, args.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  meta: { source: args.input, projection: 'equal-earth', generated: new Date().toISOString() },
  polys,
}));

console.log(`\n  ${polys.length} land polygons -> ${args.out} (${(statSync(outPath).size / 1024).toFixed(1)} KB)\n`);
