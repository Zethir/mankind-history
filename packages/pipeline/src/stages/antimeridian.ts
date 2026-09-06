import type { LonLat, LonLatPolygon, LonLatRing } from "./normalise";

/**
 * A ring crosses the antimeridian when a segment between consecutive vertices
 * jumps more than 180 degrees of longitude, which is how GeoJSON expresses a
 * crossing: 170 followed by -170 is a 20-degree step written as a 340 one.
 *
 * One shape produces the same wide jump without being a crossing: a polar cap
 * ring that runs along a pole, e.g. Natural Earth's Antarctica, which steps
 * from [180, -90] to [-180, -90]. Both endpoints are the same point on the
 * globe -- lines of longitude converge to nothing at a pole -- so this is a
 * zero-length seam along the pole line, not 360 degrees of travel. Unwrapping
 * and band-clipping it fabricates a chord across the map that never existed
 * (see docs/decisions/0012-antimeridian-cutting.md), so a step is only a
 * crossing when at least one endpoint is off the pole.
 */
export function ringWraps(ring: LonLatRing): boolean {
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1] as LonLat;
    const b = ring[i] as LonLat;
    if (Math.abs(a[1]) === 90 && Math.abs(b[1]) === 90) continue;
    if (Math.abs(b[0] - a[0]) > 180) return true;
  }
  return false;
}

/** Drop the duplicated closing vertex, so clipping treats the ring as a cycle. */
function openRing(ring: LonLatRing): LonLatRing {
  const out = ring.slice();
  const first = out[0] as LonLat;
  const last = out[out.length - 1] as LonLat;
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function closeRing(ring: LonLatRing): LonLatRing {
  const first = ring[0] as LonLat;
  return [...ring, [first[0], first[1]]];
}

/** Rewrite a ring into continuous longitudes, so 170 -> -170 becomes 170 -> 190. */
function unwrapRing(ring: LonLatRing): LonLatRing {
  const out: LonLatRing = [ring[0] as LonLat];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const prev = ring[i - 1] as LonLat;
    const cur = ring[i] as LonLat;
    const step = cur[0] - prev[0];
    if (step > 180) offset -= 360;
    else if (step < -180) offset += 360;
    out.push([cur[0] + offset, cur[1]]);
  }
  return out;
}

function meanLon(ring: LonLatRing): number {
  let sum = 0;
  for (const [lon] of ring) sum += lon;
  return sum / ring.length;
}

/**
 * Sutherland-Hodgman against one vertical half-plane. Valid for concave input
 * because a half-plane is convex. It can leave zero-area spurs running along
 * the clip line on concave shapes; those lie exactly on the antimeridian at the
 * map's edge and are invisible under any fill rule.
 */
function clipHalfPlane(ring: LonLatRing, bound: number, keepBelow: boolean): LonLatRing {
  const inside = (p: LonLat) => (keepBelow ? p[0] <= bound : p[0] >= bound);
  const out: LonLatRing = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i] as LonLat;
    const prev = ring[(i + ring.length - 1) % ring.length] as LonLat;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const dx = cur[0] - prev[0];
      const t = dx === 0 ? 0 : (bound - prev[0]) / dx;
      out.push([bound, prev[1] + t * (cur[1] - prev[1])]);
    }
    if (curIn) out.push([cur[0], cur[1]]);
  }
  return out;
}

function clipToBand(ring: LonLatRing, lo: number, hi: number): LonLatRing | null {
  const clipped = clipHalfPlane(clipHalfPlane(ring, lo, false), hi, true);
  return clipped.length >= 3 ? clipped : null;
}

/**
 * Split a polygon that crosses the antimeridian into pieces that do not.
 *
 * The cut runs along a meridian at the map's edge and asserts nothing about
 * territory. See docs/decisions/0012-antimeridian-cutting.md. Polygons that do
 * not wrap are returned byte-for-byte untouched.
 */
export function cutPolygonAtAntimeridian(polygon: LonLatPolygon): LonLatPolygon[] {
  if (!polygon.some(ringWraps)) return [polygon];

  const outerSource = polygon[0] as LonLatRing;
  const outer = unwrapRing(openRing(outerSource));
  const outerMean = meanLon(outer);

  const rings: LonLatRing[] = [outer];
  for (let i = 1; i < polygon.length; i++) {
    const hole = unwrapRing(openRing(polygon[i] as LonLatRing));
    // Put the hole in the same 360-degree frame as the outer ring, or it lands
    // in a band the outer ring does not occupy and is silently dropped.
    const shift = Math.round((outerMean - meanLon(hole)) / 360) * 360;
    rings.push(shift === 0 ? hole : hole.map(([lon, lat]) => [lon + shift, lat] as LonLat));
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [lon] of ring) {
      if (lon < min) min = lon;
      if (lon > max) max = lon;
    }
  }

  const firstBand = Math.floor((min + 180) / 360);
  const lastBand = Math.floor((max + 180) / 360);
  const out: LonLatPolygon[] = [];

  for (let band = firstBand; band <= lastBand; band++) {
    const lo = -180 + 360 * band;
    const hi = 180 + 360 * band;
    const clippedOuter = clipToBand(rings[0] as LonLatRing, lo, hi);
    if (!clippedOuter) continue;

    const shifted: LonLatPolygon = [
      closeRing(clippedOuter.map(([lon, lat]) => [lon - 360 * band, lat] as LonLat)),
    ];
    for (let i = 1; i < rings.length; i++) {
      const clippedHole = clipToBand(rings[i] as LonLatRing, lo, hi);
      if (clippedHole) {
        shifted.push(closeRing(clippedHole.map(([lon, lat]) => [lon - 360 * band, lat] as LonLat)));
      }
    }
    out.push(shifted);
  }

  return out;
}

export function cutPolygons(polygons: LonLatPolygon[]): {
  polygons: LonLatPolygon[];
  cut: number;
} {
  const out: LonLatPolygon[] = [];
  let cut = 0;
  for (const polygon of polygons) {
    const pieces = cutPolygonAtAntimeridian(polygon);
    if (pieces.length > 1 || polygon.some(ringWraps)) cut++;
    out.push(...pieces);
  }
  return { polygons: out, cut };
}
