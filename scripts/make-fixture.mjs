#!/usr/bin/env node
// Generates a fake Cliopatria-shaped file so the pipeline can be exercised
// before you have the real 15K-record download. Delete this once the real file
// is in data/. The shapes are meaningless; only the schema is real.
//
//   node scripts/make-fixture.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NAMES = [
  'Roman Republic', 'Roman Empire', 'Ptolemaic Kingdom', 'Seleucid Empire',
  'Parthian Empire', 'Sasanian Empire', 'Kingdom of Numidia', 'Carthage',
  'Kingdom of Armenia', 'Bosporan Kingdom', 'Nabataean Kingdom', 'Gaul',
  'Visigothic Kingdom', 'Vandal Kingdom', 'Ostrogothic Kingdom', 'Kush',
];

// A deterministic pseudo-random source, so the fixture is reproducible.
let seed = 20260831;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function blob(cx, cy, radius, points = 14) {
  const ring = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius * (0.55 + rand() * 0.75);
    ring.push([
      Number((cx + Math.cos(angle) * r * 1.7).toFixed(4)),
      Number((cy + Math.sin(angle) * r).toFixed(4)),
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

const features = [];

for (const name of NAMES) {
  const cx = -8 + rand() * 50;
  const cy = 27 + rand() * 20;
  // Uneven sampling on purpose: some polities get many versions, some get one.
  // This is the lumpiness the real dataset has, and the thing the spike must
  // be able to surface.
  const versionCount = 1 + Math.floor(rand() * 7);
  let year = -220 + Math.floor(rand() * 300);
  for (let v = 0; v < versionCount; v++) {
    const span = 15 + Math.floor(rand() * 140);
    const multi = rand() > 0.75;
    features.push({
      type: 'Feature',
      properties: {
        Name: name,
        Type: 'POLITY',
        FromYear: year,
        ToYear: year + span,
        Area: Math.round(50000 + rand() * 3000000),
        Wikipedia: name.replace(/ /g, '_'),
        Wikidata: `Q${100000 + Math.floor(rand() * 900000)}`,
        SeshatID: rand() > 0.6 ? Math.floor(rand() * 400) : null,
      },
      geometry: multi
        ? {
            type: 'MultiPolygon',
            coordinates: [
              [blob(cx, cy, 2 + rand() * 3)],
              [blob(cx + 6, cy - 3, 1 + rand())],
            ],
          }
        : { type: 'Polygon', coordinates: [blob(cx, cy, 2 + rand() * 4)] },
    });
    // Gaps between versions, sometimes. Absence of data, not absence of polity.
    year += span + (rand() > 0.7 ? Math.floor(rand() * 60) : 0);
  }
}

// Noise the extractor must correctly discard.
features.push({
  type: 'Feature',
  properties: { Name: 'Some Relation', Type: 'RELATION', FromYear: 0, ToYear: 100, Area: 1 },
  geometry: { type: 'Polygon', coordinates: [blob(10, 40, 2)] },
});
features.push({
  type: 'Feature',
  properties: { Name: 'Bad Years', Type: 'POLITY', FromYear: null, ToYear: 'oops', Area: 1 },
  geometry: { type: 'Polygon', coordinates: [blob(10, 40, 2)] },
});
features.push({
  type: 'Feature',
  properties: { Name: 'Han Dynasty', Type: 'POLITY', FromYear: -200, ToYear: 220, Area: 6000000 },
  geometry: { type: 'Polygon', coordinates: [blob(110, 34, 8)] }, // outside the Med bbox
});

const outPath = resolve(ROOT, 'data/cliopatria.geojson');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`\n  Fixture written: ${features.length} features -> data/cliopatria.geojson`);
console.log(`  Replace this with the real download when you have it.\n`);
