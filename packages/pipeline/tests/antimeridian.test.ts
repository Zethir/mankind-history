import { describe, expect, it } from "vitest";
import { cutPolygonAtAntimeridian, cutPolygons, ringWraps } from "../src/stages/antimeridian";
import type { LonLatPolygon, LonLatRing } from "../src/stages/normalise";

/** A closed rectangle ring, counter-clockwise. */
function box(minLon: number, minLat: number, maxLon: number, maxLat: number): LonLatRing {
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

/** A box written the way GeoJSON expresses one straddling the antimeridian. */
const straddling: LonLatRing = [
  [170, 0],
  [-170, 0],
  [-170, 10],
  [170, 10],
  [170, 0],
];

/**
 * A polar cap ring shaped like Natural Earth's Antarctica: it runs along the
 * top of a continent, down to the pole at lon 180, steps across to lon -180
 * along the pole line (both points are the same spot on the globe, not a
 * 360-degree jump), then back up to close. This is the shape that exposed the
 * bug -- see docs/decisions/0012-antimeridian-cutting.md.
 */
const polarCap: LonLatRing = [
  [0, -80],
  [90, -75],
  [180, -80],
  [180, -90],
  [-180, -90],
  [-90, -85],
  [0, -80],
];

describe("ringWraps", () => {
  it("is false for an ordinary ring", () => {
    expect(ringWraps(box(0, 0, 10, 10))).toBe(false);
  });
  it("reads a 358-degree step as a crossing, which is the only reading available", () => {
    // A box written -179 -> 179 is indistinguishable from one crossing the
    // antimeridian: both are a step of more than 180 degrees. GeoJSON gives no
    // way to tell them apart, so the wrapping reading wins. Nothing in
    // Cliopatria spans the world the long way round, so this costs nothing.
    expect(ringWraps(box(-179, 0, 179, 10))).toBe(true);
  });
  it("is true when a segment jumps more than 180 degrees", () => {
    expect(ringWraps(straddling)).toBe(true);
  });
  it("is false for a polar cap whose seam runs along a pole, not across it", () => {
    // [180, -90] -> [-180, -90] is a 360-degree step in longitude but a
    // zero-length step on the globe: both points are the same spot at the
    // pole. Regression for the Antarctica bug: this used to read true and get
    // cut, fabricating a chord across the map.
    expect(ringWraps(polarCap)).toBe(false);
  });
});

describe("cutPolygonAtAntimeridian", () => {
  it("returns an untouched polygon when nothing wraps", () => {
    const polygon: LonLatPolygon = [box(0, 0, 10, 10)];
    const result = cutPolygonAtAntimeridian(polygon);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(polygon);
  });

  it("splits a straddling ring into an east piece and a west piece", () => {
    const result = cutPolygonAtAntimeridian([straddling]);
    expect(result).toHaveLength(2);
    const lonRanges = result.map((poly) => {
      const lons = (poly[0] as LonLatRing).map(([lon]) => lon);
      return [Math.min(...lons), Math.max(...lons)];
    });
    lonRanges.sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(lonRanges[0]).toEqual([-180, -170]);
    expect(lonRanges[1]).toEqual([170, 180]);
  });

  it("leaves every output vertex inside [-180, 180]", () => {
    for (const poly of cutPolygonAtAntimeridian([straddling])) {
      for (const ring of poly) {
        for (const [lon] of ring) {
          expect(lon).toBeGreaterThanOrEqual(-180);
          expect(lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it("emits closed rings with at least four points", () => {
    for (const poly of cutPolygonAtAntimeridian([straddling])) {
      for (const ring of poly) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("preserves total longitude span, so no territory is lost in the cut", () => {
    const spans = cutPolygonAtAntimeridian([straddling]).map((poly) => {
      const lons = (poly[0] as LonLatRing).map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    });
    // The source spans 170->190, i.e. 20 degrees, split as 10 + 10.
    expect(spans.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 9);
  });

  it("carries holes into the band that contains them", () => {
    const polygon: LonLatPolygon = [straddling, box(172, 2, 174, 4)];
    const result = cutPolygonAtAntimeridian(polygon);
    const east = result.find((poly) => (poly[0] as LonLatRing).some(([lon]) => lon > 0));
    expect(east).toHaveLength(2);
  });

  it("leaves a polar cap unchanged, as a single polygon, instead of cutting the pole seam", () => {
    const polygon: LonLatPolygon = [polarCap];
    const result = cutPolygonAtAntimeridian(polygon);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(polygon);
  });
});

describe("cutPolygons", () => {
  it("counts how many polygons needed cutting", () => {
    const { polygons, cut } = cutPolygons([[box(0, 0, 10, 10)], [straddling]]);
    expect(cut).toBe(1);
    expect(polygons).toHaveLength(3);
  });
});
