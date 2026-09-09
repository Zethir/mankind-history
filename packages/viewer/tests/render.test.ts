import type { PolitiesArtifact, Version, VersionGeometry, VersionsArtifact } from "@history/model";
import { COORD_SCALE, equalEarth, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPalette } from "../src/render/palette";
import { fitWorld, fromScreen, toScreen } from "../src/render/transform";

describe("transform", () => {
  const view = fitWorld(1400, 700);

  it("centres the projected world in the canvas", () => {
    const [cx, cy] = toScreen(view, 0, 0, COORD_SCALE.coarse);
    expect(cx).toBeCloseTo(700, 6);
    expect(cy).toBeCloseTo(350, 6);
  });

  it("fits the whole world inside the canvas", () => {
    const s = COORD_SCALE.coarse;
    const corners: Array<[number, number]> = [
      [-WORLD_HALF_WIDTH * s, -WORLD_HALF_HEIGHT * s],
      [WORLD_HALF_WIDTH * s, WORLD_HALF_HEIGHT * s],
    ];
    for (const [x, y] of corners) {
      const [sx, sy] = toScreen(view, x, y, s);
      expect(sx).toBeGreaterThanOrEqual(-1e-6);
      expect(sx).toBeLessThanOrEqual(1400 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeLessThanOrEqual(700 + 1e-6);
    }
  });

  it("puts north at the top", () => {
    const s = COORD_SCALE.coarse;
    const [, north] = toScreen(view, 0, s, s);
    const [, south] = toScreen(view, 0, -s, s);
    expect(north).toBeLessThan(south);
  });

  // Pins fitWorld's scale to the exact intended minimum, computed from the
  // model constants (not a hardcoded number) so this survives a constants
  // change but still fails a spurious factor error such as scaling by
  // WORLD_HALF_WIDTH * 4 instead of * 2.
  it("picks the exact minimum scale that fits both dimensions", () => {
    const expected = Math.min(1400 / (WORLD_HALF_WIDTH * 2), 700 / (WORLD_HALF_HEIGHT * 2));
    expect(view.scale).toBeCloseTo(expected, 9);
  });

  // A 1400x700 canvas against a world 2.054:1 wide is width-bound: the fitted
  // world's left/right edges must touch the canvas edges, not merely fall
  // short of overflowing them. Containment alone (the previous test) would
  // pass even if the scale were silently halved.
  it("touches the left and right edges when width-bound", () => {
    const s = COORD_SCALE.coarse;
    const [left] = toScreen(view, -WORLD_HALF_WIDTH * s, 0, s);
    const [right] = toScreen(view, WORLD_HALF_WIDTH * s, 0, s);
    expect(left).toBeCloseTo(0, 6);
    expect(right).toBeCloseTo(1400, 6);
  });

  // Same check in the other orientation, so the Math.min in fitWorld is
  // pinned on both branches: a canvas short enough to be height-bound must
  // have its top/bottom edges touch, which a width-bound-only test can't see.
  it("touches the top and bottom edges when height-bound", () => {
    const shortView = fitWorld(1400, 400);
    const s = COORD_SCALE.coarse;
    const [, top] = toScreen(shortView, 0, WORLD_HALF_HEIGHT * s, s);
    const [, bottom] = toScreen(shortView, 0, -WORLD_HALF_HEIGHT * s, s);
    expect(top).toBeCloseTo(0, 6);
    expect(bottom).toBeCloseTo(400, 6);
  });

  // Acceptance criterion 16.
  it("round-trips a coordinate to within one pixel", () => {
    const s = COORD_SCALE.coarse;
    const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
    let checked = 0;
    for (const g of Object.values(versions.geometry)) {
      for (const poly of g.polygons) {
        for (const ring of poly) {
          for (let i = 0; i + 1 < ring.length; i += 2) {
            const x = ring[i] as number;
            const y = ring[i + 1] as number;
            const [sx, sy] = toScreen(view, x, y, s);
            const [bx, by] = fromScreen(view, sx, sy, s);
            const [rx, ry] = toScreen(view, bx, by, s);
            expect(Math.abs(rx - sx)).toBeLessThan(1);
            expect(Math.abs(ry - sy)).toBeLessThan(1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("palette", () => {
  const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
  const polities = readArtifact<PolitiesArtifact>("fixtures/dist/polities.json").polities;

  // Acceptance criterion 17. Colour must be stable per polity: crossfading
  // between two versions of one polity while its colour shifts would read as
  // one entity being replaced by another -- exactly the false assertion
  // decision 0001 exists to avoid.
  it("gives a polity the same colour every time it is asked", () => {
    const palette = buildPalette(versions);
    for (const p of polities) {
      expect(palette.colourFor(p.id)).toBe(palette.colourFor(p.id));
    }
  });

  // Test 3: determinism. Building the palette twice from the same artifact
  // must be byte-identical for every polity. Colour is not a pure function of
  // the id alone -- tier-1 membership and its colour index both depend on
  // every polity's versions in this artifact (see decision 0016) -- so this
  // is a separate guarantee from the self-equality test above. It is the one
  // that would catch a Map/Set iteration order dependency, an unstable sort,
  // or greedy colouring visiting nodes in a non-deterministic tie-break
  // order.
  it("builds the same colours twice from the same artifact", () => {
    const first = buildPalette(versions);
    const second = buildPalette(versions);
    for (const p of polities) {
      expect(second.colourFor(p.id), p.id).toBe(first.colourFor(p.id));
    }
  });

  // "Stable across runs" needs an actual colour pinned somewhere, not just
  // self-equality: `colourFor(p.id) === colourFor(p.id)` cannot fail for any
  // pure function, and the sibling tests derive their expectation from the
  // same id they colour, so neither can catch a changed palette. This golden
  // vector is the deliberate diff: a feel-session tweak to a saturation or
  // lightness constant shows up here as a failing object-diff naming every
  // polity whose colour moved, rather than passing silently. Verified by
  // temporarily changing TIER1_SATURATION from 62 to 60 -- see the report
  // this shipped with for both the failing and the restored-green run.
  //
  // Regenerated for the two-tier palette. Three of these twelve fixture
  // polities turn out to qualify for tier 1 (a version bounding box spanning
  // more than 45 degrees of longitude): Eastern Roman Empire (Justinian's
  // African and Italian reconquest, 536-554, spans ~47 degrees), Kingdom of
  // Italy (a small Tianjin concession held 1901-1943 alongside the mainland
  // pushes several of its interwar versions past 110 degrees), and Nazi
  // Germany (occupied territory reaching from France to deep in the occupied
  // USSR, 45.42 degrees at its widest version -- only 0.42 above the
  // threshold, computed and confirmed, not eyeballed). This was not expected
  // going in -- see the report for the full check of whether this fixture
  // has any sprawling polity at all -- and it means this fixture happens to
  // also exercise the tier-1 guarantee for real: Kingdom of Italy and Nazi
  // Germany are both tier 1 and genuinely co-visible (1936-1943), and get
  // different colours (hue 0 vs hue 36) below.
  it("matches the committed golden colours for the fixture's polities", () => {
    const golden: Record<string, string> = {
      "name:Eastern Roman Empire": "hsl(0 62% 74%)",
      "name:Etruscans": "hsl(180 26% 38%)",
      "name:Kingdom of Italy": "hsl(0 62% 74%)",
      "name:Nazi Germany": "hsl(36 62% 74%)",
      "name:Ostrogothic Kingdom": "hsl(180 26% 60%)",
      "name:Papal States": "hsl(300 26% 60%)",
      "name:Republic of Italy": "hsl(180 26% 60%)",
      "name:Roman Kingdom": "hsl(120 26% 60%)",
      "name:Roman Republic": "hsl(210 26% 38%)",
      "name:Vandal Kingdom": "hsl(90 26% 48%)",
      "name:Visigoths": "hsl(0 26% 38%)",
      "name:Western Roman Empire": "hsl(30 26% 38%)",
    };
    const palette = buildPalette(versions);
    const actual: Record<string, string> = {};
    for (const p of polities) actual[p.id] = palette.colourFor(p.id);
    // One object-level assertion, so a mismatch reports every affected
    // polity's id and colour at once instead of stopping at the first.
    expect(actual).toEqual(golden);
  });

  // Test 4: stability per polity.
  it("gives every version of one polity the same colour", () => {
    const palette = buildPalette(versions);
    const byPolity = new Map<string, Set<string>>();
    for (const r of versions.rows) {
      const seen = byPolity.get(r.polityId) ?? new Set<string>();
      seen.add(palette.colourFor(r.polityId));
      byPolity.set(r.polityId, seen);
    }
    for (const [polityId, colours] of byPolity) {
      expect(colours.size, polityId).toBe(1);
    }
  });

  it("produces a valid colour string for every polity", () => {
    const palette = buildPalette(versions);
    for (const p of polities) {
      expect(palette.colourFor(p.id)).toMatch(/^hsl\(\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%\)$/);
    }
  });

  // Kingdom of Italy and Nazi Germany (see the golden-vector comment above)
  // are both tier 1 and were both really on the map at the same time
  // (1936-1943). This is the guarantee, observed on real, if small, data
  // rather than constructed data: it would be a coincidence for the golden
  // vector above to keep passing if this regressed, but that test does not
  // *name* what it is protecting, so this one does.
  //
  // Nazi Germany's widest version spans 45.42 degrees, only 0.42 above
  // SPRAWL_THRESHOLD_DEGREES -- a fragile margin. A regression that dropped
  // it to tier 2 would still pass a bare colour inequality (the tiers use
  // disjoint saturations, so a tier-1/tier-2 pair is trivially unequal too),
  // silently stopping this test from testing the guarantee it names. Both
  // saturations are pinned to tier 1's 62% first so that failure mode is
  // itself caught.
  it("gives the fixture's one genuinely co-visible sprawling pair different colours", () => {
    const palette = buildPalette(versions);
    const italy = palette.colourFor("name:Kingdom of Italy");
    const germany = palette.colourFor("name:Nazi Germany");
    const saturationOf = (colour: string) => /^hsl\([\d.]+ (\d+)%/.exec(colour)?.[1];
    expect(saturationOf(italy), "Kingdom of Italy must be tier 1").toBe("62");
    expect(saturationOf(germany), "Nazi Germany must be tier 1").toBe("62");
    expect(italy).not.toBe(germany);
  });
});

/**
 * A version whose bounding box spans exactly `spanDeg` degrees of longitude at
 * the equator, per `lonSpanDegrees` in palette.ts (both corners unprojected at
 * the same latitude). The equator is the simplest case to construct by
 * forward-projecting instead of guessing scaled-integer coordinates: at
 * lat 0, Equal Earth's x is linear in longitude, so this is exactly invertible
 * by the palette's own span calculation.
 */
function bboxSpanningDegrees(
  spanDeg: number,
  coordScale: number,
): [number, number, number, number] {
  const half = spanDeg / 2;
  const [xMin] = equalEarth(-half, 0);
  const [xMax] = equalEarth(half, 0);
  return [Math.round(xMin * coordScale), 0, Math.round(xMax * coordScale), 0];
}

function makeVersion(id: string, polityId: string, fromYear: number, toYear: number): Version {
  return {
    id,
    polityId,
    fromYear,
    toYear,
    area: 1000,
    // Schema 2 added membership. These synthetic polities stand alone: none is
    // a member of an aggregate, which is what the palette tests are about.
    memberOf: null,
    prevId: null,
    delta: null,
    gap: null,
    confidence: null,
    source: { dataset: "cliopatria", version: "test" },
  };
}

function makeGeometry(bbox: [number, number, number, number]): VersionGeometry {
  return { polygons: [], bbox, anchor: [0, 0] };
}

/**
 * Six sprawling polities (bbox span 60 degrees, well past the 45-degree
 * threshold) all visible in the same years, 1900-1950, plus one compact
 * polity (span 5 degrees) visible over the same span.
 *
 * The fixture's real tier-1 polities (see the golden-vector test) are too few
 * and too historically scattered in time to exercise this on their own: the
 * one genuinely co-visible real pair is exactly two polities, which is not
 * enough to guarantee catching a broken implementation, only enough to notice
 * if this particular one broke. This synthetic artifact is built to fail
 * against the pre-decision-0016 hash-only implementation on purpose -- see
 * the guarantee test below for exactly how.
 */
const SPRAWL_IDS = [
  "name:Sprawler 0",
  "name:Sprawler 1",
  "name:Sprawler 2",
  "name:Sprawler 38",
  "name:Sprawler 39",
  "name:Sprawler 74",
];
const COMPACT_ID = "name:Compact A";

function buildSyntheticArtifact(): VersionsArtifact {
  const coordScale = 100_000;
  const rows: Version[] = [];
  const geometry: Record<string, VersionGeometry> = {};

  for (const polityId of SPRAWL_IDS) {
    const versionId = `${polityId}@1900`;
    rows.push(makeVersion(versionId, polityId, 1900, 1950));
    geometry[versionId] = makeGeometry(bboxSpanningDegrees(60, coordScale));
  }

  const compactVersionId = `${COMPACT_ID}@1900`;
  rows.push(makeVersion(compactVersionId, COMPACT_ID, 1900, 1950));
  geometry[compactVersionId] = makeGeometry(bboxSpanningDegrees(5, coordScale));

  return { schemaVersion: 1, level: "coarse", coordScale, rows, geometry };
}

describe("palette: tier-1 sprawl guarantee (synthetic artifact)", () => {
  // Test 1: the guarantee, and the one that matters most in this file.
  //
  // All six ids below share one year range (1900-1950), so every pair is
  // co-visible and none may share a colour. This is deliberately constructed
  // to fail against the palette this change replaces: under the
  // pre-decision-0016 implementation (`hash(id) % 16` for hue, `hash(id)`
  // again for one of two lightness bands, no notion of co-visibility at
  // all), FNV-1a puts "name:Sprawler 0" and "name:Sprawler 39" in the exact
  // same hue/lightness bucket -- both resolve to the byte-identical
  // "hsl(45 34% 62%)" -- and separately puts "name:Sprawler 1",
  // "name:Sprawler 38" and "name:Sprawler 74" all in another shared bucket,
  // "hsl(112.5 34% 52%)". Confirmed by running that exact formula
  // (`packages/viewer/src/render/palette.ts` as of commit `6f52e13`) against
  // these six ids. A palette that goes back to colouring tier-1 polities by a
  // bare hash of the id, without the co-visibility graph, reproduces that
  // collision and fails this test.
  it("gives every simultaneously-visible sprawling polity its own colour", () => {
    const palette = buildPalette(buildSyntheticArtifact());
    const colours = SPRAWL_IDS.map((id) => palette.colourFor(id));
    expect(new Set(colours).size).toBe(SPRAWL_IDS.length);
  });

  // Test 2: tier separation. A sprawling polity and a compact one must never
  // resolve to the same colour string, so an empire can never read as just
  // another local polity. Saturation is what actually separates the tiers
  // (62% vs 26%), so this also pins that "Compact A" -- which happens to
  // land in the same hue band as one of the sprawlers -- is still told apart
  // by saturation alone.
  it("never gives a sprawling polity the same colour as a compact one", () => {
    const palette = buildPalette(buildSyntheticArtifact());
    const compactColour = palette.colourFor(COMPACT_ID);
    for (const id of SPRAWL_IDS) {
      expect(palette.colourFor(id), id).not.toBe(compactColour);
    }
    const compactSaturation = /^hsl\([\d.]+ (\d+)%/.exec(compactColour)?.[1];
    expect(compactSaturation).toBe("26");
    for (const id of SPRAWL_IDS) {
      const sprawlSaturation = /^hsl\([\d.]+ (\d+)%/.exec(palette.colourFor(id))?.[1];
      expect(sprawlSaturation, id).toBe("62");
    }
  });

  // Determinism, re-checked against the synthetic artifact: the real-fixture
  // version of this test (above) has only three tier-1 polities and no
  // co-visible clique larger than two, so it exercises greedy colouring's
  // ordering far less than a six-node mutually-adjacent graph does.
  it("builds the same colours twice from the same synthetic artifact", () => {
    const synthetic = buildSyntheticArtifact();
    const first = buildPalette(synthetic);
    const second = buildPalette(synthetic);
    for (const id of [...SPRAWL_IDS, COMPACT_ID]) {
      expect(second.colourFor(id), id).toBe(first.colourFor(id));
    }
  });
});

/**
 * 41 sprawling polities (one more than TIER1_COLOUR_COUNT's 40), all
 * mutually co-visible (same 1900-1950 year range for every one of them), so
 * the co-visibility graph is a complete graph on 41 nodes. Greedy colouring a
 * complete graph always needs exactly as many colours as nodes -- every pair
 * is adjacent, so no two can ever share an index -- which forces colour
 * indices 0..40, one past the 40 reserved.
 */
const OVERFLOW_IDS = Array.from({ length: 41 }, (_, i) => `name:Overflow ${i}`);

function buildOverflowArtifact(): VersionsArtifact {
  const coordScale = 100_000;
  const rows: Version[] = [];
  const geometry: Record<string, VersionGeometry> = {};
  for (const polityId of OVERFLOW_IDS) {
    const versionId = `${polityId}@1900`;
    rows.push(makeVersion(versionId, polityId, 1900, 1950));
    geometry[versionId] = makeGeometry(bboxSpanningDegrees(60, coordScale));
  }
  return { schemaVersion: 1, level: "coarse", coordScale, rows, geometry };
}

describe("palette: tier-1 colour-reservation overflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TIER1_COLOUR_COUNT (40) has never been exceeded against real data (see
  // the report this shipped with: 34 of 40 used at the real dist/'s 8-year
  // margin), so nothing else in this suite exercises `warnOnOverflow`. An
  // overflow guard nobody has ever seen fire is a guard nobody knows works --
  // exactly the silent-failure mode it exists to replace -- so this forces it
  // with a complete graph one node larger than the reservation and checks
  // both halves of its contract: it warns, and it still returns a colour
  // (wrong, but a string, never a throw) for every polity, including the one
  // that wrapped.
  //
  // console.warn is spied on and restored (afterEach, not just at the end of
  // this test) so this deliberate overflow does not leave a stray warning in
  // the suite's own output.
  it("warns once and still returns valid colours when the graph needs more than 40", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const palette = buildPalette(buildOverflowArtifact());
    const colours = OVERFLOW_IDS.map((id) => palette.colourFor(id));

    expect(warn).toHaveBeenCalledTimes(1);
    for (const colour of colours) {
      expect(colour).toMatch(/^hsl\(\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%\)$/);
    }
    // The failure mode the warning exists to announce: with 41 mutually
    // adjacent polities and only 40 reserved colours, the modulo wraparound
    // in tier1Colour necessarily collides colour index 40 with index 0, so
    // not all 41 colours can be distinct. If this ever started passing with
    // 41 distinct colours, TIER1_COLOUR_COUNT would have silently grown and
    // this test would no longer be exercising the overflow path at all.
    expect(new Set(colours).size).toBeLessThan(OVERFLOW_IDS.length);
  });
});
