import { describe, expect, it } from "vitest";
import { COORD_SCALE } from "../src/canon";
import { equalEarth, equalEarthInverse } from "../src/projection";

/** Shoelace area of a lon/lat box projected with densely sampled edges. */
function projectedArea(minLon: number, minLat: number, maxLon: number, maxLat: number): number {
  const pts: Array<[number, number]> = [];
  const n = 200;
  const lonAt = (t: number) => minLon + (maxLon - minLon) * t;
  const latAt = (t: number) => minLat + (maxLat - minLat) * t;
  for (let i = 0; i <= n; i++) pts.push(equalEarth(lonAt(i / n), minLat));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(maxLon, latAt(i / n)));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(lonAt(1 - i / n), maxLat));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(minLon, latAt(1 - i / n)));
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    const q = pts[(i + 1) % pts.length] as [number, number];
    acc += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(acc) / 2;
}

describe("equalEarth", () => {
  it("maps the origin to the origin", () => {
    expect(equalEarth(0, 0)).toEqual([0, 0]);
  });

  it("is equal-area: a 2x2 box at 60-62N is cos(61) of the same box at the equator", () => {
    // Decision 0002 records this check. cos(61 degrees) = 0.48481.
    const ratio = projectedArea(0, 60, 2, 62) / projectedArea(0, 0, 2, 2);
    expect(ratio).toBeCloseTo(0.4849, 3);
  });

  it("keeps the world inside the documented projected bounds", () => {
    const [xMax] = equalEarth(180, 0);
    const [, yMax] = equalEarth(0, 90);
    expect(xMax).toBeGreaterThan(2.7);
    expect(xMax).toBeLessThan(2.71);
    expect(yMax).toBeGreaterThan(1.3);
    expect(yMax).toBeLessThan(1.32);
  });
});

describe("equalEarthInverse", () => {
  it("round-trips the unquantised projection to within 1e-9 degrees", () => {
    // Equal Earth is pseudocylindrical: the pole is a line, not a point, so
    // longitude is recoverable at every latitude including +/-90.
    for (let lon = -180; lon <= 180; lon += 7.5) {
      for (let lat = -90; lat <= 90; lat += 7.5) {
        const [x, y] = equalEarth(lon, lat);
        const [backLon, backLat] = equalEarthInverse(x, y);
        expect(backLon).toBeCloseTo(lon, 9);
        expect(backLat).toBeCloseTo(lat, 9);
      }
    }
  });

  it("round-trips through full-detail integer quantisation within 1e-6 degrees", () => {
    const scale = COORD_SCALE.full;
    for (let lon = -179; lon <= 179; lon += 11) {
      for (let lat = -89; lat <= 89; lat += 11) {
        const [x, y] = equalEarth(lon, lat);
        const [backLon, backLat] = equalEarthInverse(
          Math.round(x * scale) / scale,
          Math.round(y * scale) / scale,
        );
        expect(Math.abs(backLon - lon)).toBeLessThan(1e-6);
        expect(Math.abs(backLat - lat)).toBeLessThan(1e-6);
      }
    }
  });

  it("round-trips stored coordinates to themselves at every latitude, poles included", () => {
    // Latitude recovery is ill-conditioned at the pole for ANY equal-area
    // projection at ANY finite precision: a degree of latitude there covers
    // vanishing area, so y compresses it without bound. What still holds
    // everywhere -- and what actually catches a scale/projection mismatch -- is
    // that a stored integer un-projects and re-projects to itself.
    const scale = COORD_SCALE.full;
    for (let lon = -180; lon <= 180; lon += 30) {
      for (const lat of [-90, -89.9, -89, -45, 0, 45, 89, 89.9, 90]) {
        const [x, y] = equalEarth(lon, lat);
        const ix = Math.round(x * scale);
        const iy = Math.round(y * scale);
        const [backLon, backLat] = equalEarthInverse(ix / scale, iy / scale);
        expect(Number.isFinite(backLon)).toBe(true);
        expect(Number.isFinite(backLat)).toBe(true);
        const [rx, ry] = equalEarth(backLon, backLat);
        expect(Math.abs(Math.round(rx * scale) - ix)).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.round(ry * scale) - iy)).toBeLessThanOrEqual(1);
      }
    }
  });
});
