import { readFileSync } from 'node:fs';

/**
 * Cliopatria ships as one large GeoJSON FeatureCollection. Reading it needs a
 * raised heap: run node with --max-old-space-size=8192. If that still fails,
 * the README has a mapshaper fallback that pre-filters the file on disk.
 */
export function readFeatureCollection(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `No file at ${path}. Unzip cliopatria.geojson.zip into data/ first.`
      );
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.features)) {
    throw new Error(`${path} is not a GeoJSON FeatureCollection.`);
  }
  return parsed;
}

/** Bounding box of a Polygon or MultiPolygon: [minLon, minLat, maxLon, maxLat]. */
export function geometryBbox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Defensive: some rows in the wild carry a type that disagrees with the
  // nesting depth of their coordinates. Skip anything that is not a pair of
  // finite numbers rather than throwing, and let the caller drop the feature.
  const visitRing = (ring) => {
    if (!Array.isArray(ring)) return;
    for (const point of ring) {
      if (!Array.isArray(point)) continue;
      const [x, y] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(visitRing);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) poly.forEach(visitRing);
  } else {
    return null;
  }
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

export function bboxIntersects(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Do [aFrom, aTo] and [bFrom, bTo] overlap? Inclusive on both ends. */
export function intervalsOverlap(aFrom, aTo, bFrom, bTo) {
  return aFrom <= bTo && bFrom <= aTo;
}

/**
 * Cliopatria years are integers, negative for BCE. Some rows carry them as
 * strings. Normalise, and return null for anything unusable.
 */
export function toYear(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}
