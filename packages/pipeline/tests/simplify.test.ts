import { describe, expect, it } from "vitest";
import { simplifyPolygonGroups } from "../src/stages/simplify";

/** A closed square ring as flat scaled-integer coordinates. */
const square = (x: number, y: number, size: number): number[] => [
  x,
  y,
  x + size,
  y,
  x + size,
  y + size,
  x,
  y + size,
  x,
  y,
];

/** A ring with many collinear-ish points that simplification should thin. */
function noisyRing(x: number, y: number, size: number, points: number): number[] {
  const flat: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / points;
    const angle = t * Math.PI * 2;
    const r = size * (0.9 + 0.1 * Math.sin(angle * 7));
    flat.push(Math.round(x + Math.cos(angle) * r), Math.round(y + Math.sin(angle) * r));
  }
  flat.push(flat[0] as number, flat[1] as number);
  return flat;
}

describe("simplifyPolygonGroups", () => {
  it("returns one entry per input id", async () => {
    const out = await simplifyPolygonGroups(
      [
        { id: "a", polygons: [[square(0, 0, 1000)]] },
        { id: "b", polygons: [[square(5000, 0, 1000)]] },
      ],
      50,
    );
    expect([...out.keys()].sort()).toEqual(["a", "b"]);
  });

  it("removes vertices at a low retention percentage", async () => {
    const ring = noisyRing(0, 0, 100000, 200);
    const out = await simplifyPolygonGroups([{ id: "a", polygons: [[ring]] }], 10);
    const simplified = out.get("a")?.[0]?.[0] as number[];
    expect(simplified.length).toBeLessThan(ring.length);
    expect(simplified.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every polygon, so a small shape cannot vanish (keep-shapes)", async () => {
    const groups = [
      { id: "big", polygons: [[noisyRing(0, 0, 1000000, 400)]] },
      { id: "tiny", polygons: [[square(9000000, 9000000, 50)]] },
    ];
    const out = await simplifyPolygonGroups(groups, 2);
    expect(out.get("tiny")?.length).toBe(1);
    expect(out.get("big")?.length).toBe(1);
  });

  it("emits closed rings of at least four points with integer coordinates", async () => {
    const out = await simplifyPolygonGroups(
      [{ id: "a", polygons: [[noisyRing(0, 0, 500000, 120)]] }],
      25,
    );
    for (const polygon of out.get("a") ?? []) {
      for (const ring of polygon) {
        expect(ring.length % 2).toBe(0);
        expect(ring.length / 2).toBeGreaterThanOrEqual(4);
        expect(ring.every(Number.isInteger)).toBe(true);
        expect(ring[0]).toBe(ring[ring.length - 2]);
        expect(ring[1]).toBe(ring[ring.length - 1]);
      }
    }
  });

  it("is deterministic: the same input twice gives byte-identical output", async () => {
    // This is the milestone's headline risk. Decision 0010 scopes byte-identical
    // builds to a pinned toolchain; if mapshaper varies between runs, the golden
    // fixture artifacts become noise and the determinism criterion is unfounded.
    const groups = [
      { id: "a", polygons: [[noisyRing(0, 0, 800000, 300)]] },
      { id: "b", polygons: [[noisyRing(2000000, 500000, 600000, 250)]] },
      { id: "c", polygons: [[square(-1000000, -1000000, 400000)]] },
    ];
    const first = await simplifyPolygonGroups(groups, 15);
    const second = await simplifyPolygonGroups(groups, 15);
    expect(JSON.stringify([...second])).toBe(JSON.stringify([...first]));
  });

  it("keeps a noisy shared boundary identical on both sides", async () => {
    // The shared edge must be detailed enough that simplification is forced to
    // remove points from it. Two axis-aligned squares cannot lose a corner, so
    // a square-based version of this test passes even when shared topology is
    // discarded -- which is the exact regression it is here to catch.
    //
    // The two polygons' private (non-shared) tails must NOT be a mirror image
    // of each other. An earlier version of this test closed both sides with a
    // simple two-point corner, differing only in the sign of y -- symmetric
    // enough that independently simplifying each ring landed on the same kept
    // points by geometric coincidence, with no shared topology involved at
    // all. Verified empirically: that version passed even when this function
    // was rewritten to call mapshaper once per group. South's tail here is a
    // four-point asymmetric zigzag specifically so the two rings are NOT
    // mirror images, which was confirmed (same way) to make the per-group
    // rewrite actually fail this test.
    const boundary: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i++) {
      boundary.push([Math.round((i / 60) * 600000), Math.round(Math.sin(i * 1.7) * 9000)]);
    }
    const flat = (pts: Array<[number, number]>): number[] => pts.flat();
    const first = boundary[0] as [number, number];
    const last = boundary[boundary.length - 1] as [number, number];
    const north = flat([...boundary, [600000, 400000], [0, 400000], first]);
    const south = flat([
      ...[...boundary].reverse(),
      [0, -350000],
      [150000, -900000],
      [450000, -900000],
      [600000, -350000],
      last,
    ]);

    const out = await simplifyPolygonGroups(
      [
        { id: "north", polygons: [[north]] },
        { id: "south", polygons: [[south]] },
      ],
      20,
    );

    // Points on the shared edge only -- the far corners sit at |y| = 400000.
    const onBoundary = (id: string) => {
      const keys = new Set<string>();
      for (const polygon of out.get(id) ?? []) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length; i += 2) {
            const y = ring[i + 1] as number;
            if (Math.abs(y) <= 9000) keys.add(`${ring[i]},${y}`);
          }
        }
      }
      return keys;
    };

    const northKept = onBoundary("north");
    const southKept = onBoundary("south");
    // If nothing was removed the test proves nothing, so assert removal happened.
    expect(northKept.size).toBeLessThan(boundary.length);
    expect(northKept.size).toBeGreaterThan(2);
    expect([...northKept].sort()).toEqual([...southKept].sort());
  });
});
