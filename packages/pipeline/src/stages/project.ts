import type { Polygon, Ring, VersionGeometry } from "@history/model";
import { equalEarth } from "@history/model";
import polylabel from "polylabel";
import type { LonLatPolygon } from "./normalise";

/** Project a polygon's rings to unrounded projected [x, y] pairs. */
function projectRings(polygon: LonLatPolygon): Array<Array<[number, number]>> {
  return polygon.map((ring) => ring.map(([lon, lat]) => equalEarth(lon, lat)));
}

/** Shoelace area of a projected outer ring. Equal Earth is equal-area, so this
 *  ranks polygons by real territorial extent. */
function ringArea(ring: Array<[number, number]>): number {
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as number[];
    const q = ring[(i + 1) % ring.length] as number[];
    acc += (p[0] as number) * (q[1] as number) - (q[0] as number) * (p[1] as number);
  }
  return Math.abs(acc) / 2;
}

function flatten(rings: Array<Array<[number, number]>>, scale: number): Polygon {
  return rings.map((ring) => {
    const flat: Ring = new Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      const point = ring[i] as number[];
      flat[i * 2] = Math.round((point[0] as number) * scale);
      flat[i * 2 + 1] = Math.round((point[1] as number) * scale);
    }
    return flat;
  });
}

export function projectPolygons(polygons: LonLatPolygon[], scale: number): VersionGeometry {
  if (polygons.length === 0) throw new Error("projectPolygons requires at least one polygon");
  const projected = polygons.map(projectRings);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rings of projected) {
    for (const ring of rings) {
      for (const point of ring) {
        const x = point[0] as number;
        const y = point[1] as number;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // The anchor goes on the largest piece, so an empire's label lands on its
  // mainland rather than on an offshore island that happened to be listed first.
  let largest = projected[0] as Array<Array<[number, number]>>;
  let largestArea = -1;
  for (const rings of projected) {
    const area = ringArea(rings[0] as Array<[number, number]>);
    if (area > largestArea) {
      largestArea = area;
      largest = rings;
    }
  }
  const anchor = polylabel(largest, 1e-4);

  return {
    polygons: projected.map((rings) => flatten(rings, scale)),
    bbox: [
      Math.round(minX * scale),
      Math.round(minY * scale),
      Math.round(maxX * scale),
      Math.round(maxY * scale),
    ],
    anchor: [Math.round((anchor[0] as number) * scale), Math.round((anchor[1] as number) * scale)],
  };
}

/** Land needs no bbox or anchor: it is one static backdrop, never labelled. */
export function projectLand(polygons: LonLatPolygon[], scale: number): Polygon[] {
  return polygons.map((polygon) => flatten(projectRings(polygon), scale));
}
