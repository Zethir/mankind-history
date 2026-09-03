import { COORD_SCALE, equalEarthInverse } from "@history/model";
import { describe, expect, it } from "vitest";
import type { LonLatPolygon } from "../src/stages/normalise";
import { projectLand, projectPolygons } from "../src/stages/project";

const SCALE = COORD_SCALE.full;

const squareAt = (minLon: number, minLat: number, size: number): LonLatPolygon => [
  [
    [minLon, minLat],
    [minLon + size, minLat],
    [minLon + size, minLat + size],
    [minLon, minLat + size],
    [minLon, minLat],
  ],
];

describe("projectPolygons", () => {
  it("emits flat integer rings, two numbers per vertex", () => {
    const { polygons } = projectPolygons([squareAt(0, 0, 10)], SCALE);
    const ring = polygons[0]?.[0] as number[];
    expect(ring).toHaveLength(10);
    expect(ring.every((n) => Number.isInteger(n))).toBe(true);
  });

  it("keeps every vertex un-projectable to its source within 1e-6 degrees", () => {
    const source = squareAt(-30, 40, 12);
    const { polygons } = projectPolygons([source], SCALE);
    const ring = polygons[0]?.[0] as number[];
    const sourceRing = source[0] as Array<[number, number]>;
    for (let i = 0; i < sourceRing.length; i++) {
      const [lon, lat] = sourceRing[i] as [number, number];
      const [backLon, backLat] = equalEarthInverse(
        (ring[i * 2] as number) / SCALE,
        (ring[i * 2 + 1] as number) / SCALE,
      );
      expect(Math.abs(backLon - lon)).toBeLessThan(1e-6);
      expect(Math.abs(backLat - lat)).toBeLessThan(1e-6);
    }
  });

  it("computes a bbox enclosing every vertex of every polygon", () => {
    const { polygons, bbox } = projectPolygons([squareAt(0, 0, 5), squareAt(20, 20, 5)], SCALE);
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 2) {
          expect(ring[i] as number).toBeGreaterThanOrEqual(bbox[0]);
          expect(ring[i] as number).toBeLessThanOrEqual(bbox[2]);
          expect(ring[i + 1] as number).toBeGreaterThanOrEqual(bbox[1]);
          expect(ring[i + 1] as number).toBeLessThanOrEqual(bbox[3]);
        }
      }
    }
  });

  it("places the label anchor inside the bbox", () => {
    const { bbox, anchor } = projectPolygons([squareAt(0, 0, 10)], SCALE);
    expect(anchor[0]).toBeGreaterThan(bbox[0]);
    expect(anchor[0]).toBeLessThan(bbox[2]);
    expect(anchor[1]).toBeGreaterThan(bbox[1]);
    expect(anchor[1]).toBeLessThan(bbox[3]);
  });

  it("anchors on the largest polygon, not the first one listed", () => {
    const { anchor } = projectPolygons([squareAt(0, 0, 1), squareAt(40, 0, 20)], SCALE);
    const [lon] = equalEarthInverse(anchor[0] / SCALE, anchor[1] / SCALE);
    expect(lon).toBeGreaterThan(30);
  });

  it("is deterministic: the same input yields identical output", () => {
    const input = [squareAt(0, 0, 10), squareAt(30, -20, 7)];
    expect(projectPolygons(input, SCALE)).toEqual(projectPolygons(input, SCALE));
  });
});

describe("projectLand", () => {
  it("projects land polygons without bbox or anchor", () => {
    const polygons = projectLand([squareAt(0, 0, 10)], COORD_SCALE.coarse);
    expect(polygons[0]?.[0]).toHaveLength(10);
  });
});
