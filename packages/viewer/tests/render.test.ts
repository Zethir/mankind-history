import type { PolitiesArtifact, Version, VersionGeometry, VersionsArtifact } from "@history/model";
import { COORD_SCALE, equalEarth, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAggregateParents,
  buildPalette,
  FAMILIES,
  SHADE_LIGHTNESS,
} from "../src/render/palette";
import { buildPolityIndex } from "../src/render/polity-index";
import { colourForDraw } from "../src/render/render-mode";
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
  // the id alone -- sprawl/aggregate candidacy and colour index both depend
  // on every polity's versions in this artifact (see decision 0018) -- so
  // this is a separate guarantee from the self-equality test above. It is
  // the one that would catch a Map/Set iteration order dependency, an
  // unstable sort, or greedy colouring visiting nodes in a non-deterministic
  // tie-break order.
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
  // vector is the deliberate diff: a feel-session tweak to a hue or
  // lightness constant shows up here as a failing object-diff naming every
  // polity whose colour moved, rather than passing silently.
  //
  // Regenerated for this revision's two fixes: the near-duplicate FAMILIES
  // pair ({hue: 40, saturation: 55} vs {hue: 45, saturation: 50}, deltaE
  // 3.33 -- see the module comment on `FAMILIES` in palette.ts) replaced
  // with a set measured at true all-pairs minimum deltaE 10.46, and
  // `greedyColour` changed from "smallest free index" to "least-used-so-far"
  // (see its comment in palette.ts) so low-degree candidates stop all
  // piling onto the lightest shade band. Verified by temporarily restoring
  // the old {hue: 40, saturation: 55}/{hue: 45, saturation: 50} families and
  // confirming this test fails with the object-diff naming every affected
  // polity, then restoring the fix and confirming it passes again -- see the
  // report this shipped with for both runs.
  //
  // Three of these twelve fixture polities qualify as sprawling (a version
  // bounding box spanning more than 45 degrees of longitude): Eastern Roman
  // Empire (Justinian's African and Italian reconquest, 536-554, spans ~47
  // degrees), Kingdom of Italy (a small Tianjin concession held 1901-1943
  // alongside the mainland pushes several of its interwar versions past 110
  // degrees), and Nazi Germany (occupied territory reaching from France to
  // deep in the occupied USSR, 45.42 degrees at its widest version -- only
  // 0.42 above the threshold, computed and confirmed, not eyeballed). None
  // of the fixture's polities carry a non-null memberOf (measured against
  // fixtures/dist), so no merging is exercised here -- see the synthetic
  // merged-mode tests below for that. This fixture still exercises the
  // sprawl guarantee for real: Kingdom of Italy and Nazi Germany are both
  // sprawling and genuinely co-visible (1936-1943), and get different
  // colours (family 0 vs family 4) below.
  //
  // All twelve now land on twelve *distinct* colours -- a direct, visible
  // consequence of the least-used-so-far tie-break: under the old
  // smallest-free-index rule, six of these twelve (Nazi Germany, Ostrogothic
  // Kingdom, Papal States, Roman Kingdom, Vandal Kingdom, Visigoths) shared
  // one identical colour and four more (Eastern Roman Empire, Etruscans,
  // Kingdom of Italy, Western Roman Empire) shared another, four distinct
  // colours across all twelve in total. None of the newly-separated pairs
  // needed distinguishing by either graph guarantee (they are never
  // genuinely co-visible or spatially adjacent to each other) -- this is
  // finding 3's fix (1,235 of 1,583 real polities collapsing into the
  // lightest shade band) made visible on a small fixture, not a new
  // collision-avoidance guarantee.
  it("matches the committed golden colours for the fixture's polities", () => {
    const golden: Record<string, string> = {
      "name:Eastern Roman Empire": "hsl(48 62% 74%)",
      "name:Etruscans": "hsl(68 32% 74%)",
      "name:Kingdom of Italy": "hsl(5 58% 74%)",
      "name:Nazi Germany": "hsl(95 42% 74%)",
      "name:Ostrogothic Kingdom": "hsl(135 28% 74%)",
      "name:Papal States": "hsl(168 32% 74%)",
      "name:Republic of Italy": "hsl(5 58% 28%)",
      "name:Roman Kingdom": "hsl(195 38% 74%)",
      "name:Roman Republic": "hsl(330 22% 58%)",
      "name:Vandal Kingdom": "hsl(220 34% 74%)",
      "name:Visigoths": "hsl(330 22% 74%)",
      "name:Western Roman Empire": "hsl(30 62% 74%)",
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
  // are both sprawling and were both really on the map at the same time
  // (1936-1943). This is the guarantee, observed on real, if small, data
  // rather than constructed data: it would be a coincidence for the golden
  // vector above to keep passing if this regressed, but that test does not
  // *name* what it is protecting, so this one does.
  //
  // Nazi Germany's widest version spans 45.42 degrees, only 0.42 above
  // SPRAWL_THRESHOLD_DEGREES -- a fragile margin. A regression that dropped
  // it out of the sprawl candidate pool would fall through to the hash
  // fallback instead, which could coincidentally still differ from Italy's
  // colour -- so this cannot, on its own, prove sprawl status the way the
  // old two-tier saturation check could. The golden-vector test above is
  // what actually pins Nazi Germany's exact colour (and therefore its
  // candidacy); this test only names the co-visibility guarantee alongside
  // it.
  it("gives the fixture's one genuinely co-visible sprawling pair different colours", () => {
    const palette = buildPalette(versions);
    const italy = palette.colourFor("name:Kingdom of Italy");
    const germany = palette.colourFor("name:Nazi Germany");
    expect(italy).not.toBe(germany);
  });
});

/**
 * CIE76 deltaE over CIELAB, computed from an HSL triple: sRGB -> linear sRGB
 * -> XYZ (D65) -> CIELAB -> Euclidean distance. Implemented here, independent
 * of anything palette.ts does, because a regression test that reused the
 * production colour-space code could not catch a bug in that code -- and this
 * exact failure mode already happened once: an earlier CIE76 measurement
 * reported 11.9 as the palette's minimum deltaE and zero confusable pairs, a
 * figure that was wrong because the script that produced it built its
 * candidate pool with duplicate keys and ended up comparing colours other
 * than the ones actually shipped (see the module comment on `FAMILIES` in
 * palette.ts). A silently wrong colour-space conversion here would be exactly
 * that failure again, just moved into the test -- which is why the sanity
 * checks below exist: they pin this implementation against two independently
 * known reference conversions before it is trusted to grade the real
 * palette.
 */
function hslToRgb(
  hue: number,
  saturationPct: number,
  lightnessPct: number,
): [number, number, number] {
  const s = saturationPct / 100;
  const l = lightnessPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

function srgbChannelToLinear(u: number): number {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

/** sRGB (D65) to CIEXYZ, IEC 61966-2-1 matrix coefficients. */
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const [rl, gl, bl] = [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  return [x, y, z];
}

/** D65 reference white. */
const XYZ_WHITE: [number, number, number] = [0.95047, 1.0, 1.08883];

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const [fx, fy, fz] = [labF(x / XYZ_WHITE[0]), labF(y / XYZ_WHITE[1]), labF(z / XYZ_WHITE[2])];
  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bStar = 200 * (fy - fz);
  return [l, a, bStar];
}

function hslToLab(
  hue: number,
  saturationPct: number,
  lightnessPct: number,
): [number, number, number] {
  const [r, g, b] = hslToRgb(hue, saturationPct, lightnessPct);
  return xyzToLab(...rgbToXyz(r, g, b));
}

function deltaE76(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [dl, da, db] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return Math.sqrt(dl * dl + da * da + db * db);
}

describe("palette: colour distinctness (CIE76)", () => {
  // Sanity-checks the conversion pipeline above against two independently
  // known references before trusting it to grade the real palette -- see the
  // block comment above these helpers for why this step is not optional.
  it("computes L*=100 for white and the known Lab of pure red", () => {
    const white = hslToLab(0, 0, 100);
    expect(white[0]).toBeCloseTo(100, 1);
    expect(white[1]).toBeCloseTo(0, 1);
    expect(white[2]).toBeCloseTo(0, 1);

    const red = hslToLab(0, 100, 50);
    expect(red[0]).toBeCloseTo(53.2, 1);
    expect(red[1]).toBeCloseTo(80.1, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
  });

  // The regression itself: true all-pairs minimum CIE76 deltaE over the 40
  // shipped colours (10 FAMILIES x 4 SHADE_LIGHTNESS, every pair including
  // same-shade pairs across families) must stay at or above 10.0. This is
  // the exact measurement that caught {hue: 40, saturation: 55} shipping
  // alongside {hue: 45, saturation: 50} at deltaE 3.33 (see palette.ts's
  // `FAMILIES` comment) -- a defect an all-pairs-including-same-shade
  // measurement catches and a same-family-only or cross-family-only
  // measurement would not.
  it("keeps every pair of the 40 shipped colours at or above deltaE 10.0", () => {
    const labs: Array<[number, number, number]> = [];
    for (const family of FAMILIES) {
      for (const lightness of SHADE_LIGHTNESS) {
        labs.push(hslToLab(family.hue, family.saturation, lightness));
      }
    }
    expect(labs.length).toBe(40);

    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const d = deltaE76(
          labs[i] as [number, number, number],
          labs[j] as [number, number, number],
        );
        if (d < min) min = d;
      }
    }
    expect(min).toBeGreaterThanOrEqual(10.0);
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

function makeVersion(
  id: string,
  polityId: string,
  fromYear: number,
  toYear: number,
  memberOf: string | null = null,
): Version {
  return {
    id,
    polityId,
    fromYear,
    toYear,
    area: 1000,
    // Schema 2 added membership (decision 0017). Defaults to null -- most of
    // this file's synthetic polities stand alone -- but the merged-mode
    // tests below pass an aggregate id explicitly.
    memberOf,
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
 * The fixture's real sprawling polities (see the golden-vector test) are too
 * few and too historically scattered in time to exercise this on their own:
 * the one genuinely co-visible real pair is exactly two polities, which is
 * not enough to guarantee catching a broken implementation, only enough to
 * notice if this particular one broke. This synthetic artifact is built to
 * fail against a bare hash-only implementation on purpose -- see the
 * guarantee test below for exactly how.
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

describe("palette: sprawl guarantee (synthetic artifact)", () => {
  // The guarantee, and the one that matters most in this file. All six ids
  // below share one year range (1900-1950), so every pair is co-visible and
  // none may share a colour. This is deliberately constructed to fail
  // against a bare-hash palette with no notion of co-visibility at all: a
  // palette that goes back to colouring sprawling polities by a hash of the
  // id, without the co-visibility graph, reproduces a same-bucket collision
  // among these six and fails this test.
  it("gives every simultaneously-visible sprawling polity its own colour", () => {
    const palette = buildPalette(buildSyntheticArtifact());
    const colours = SPRAWL_IDS.map((id) => palette.colourFor(id));
    expect(new Set(colours).size).toBe(SPRAWL_IDS.length);
  });

  // Decision 0018 deliberately drops decision 0016's old guarantee that a
  // sprawling polity and a compact one could never share a colour string --
  // that guarantee was enforced purely by giving each population a disjoint
  // saturation, and this palette varies saturation by hue family instead, so
  // both populations now draw from the identical 40-colour space. There is
  // no test here asserting "Compact A never equals a sprawler's colour"
  // because that is no longer a guarantee this palette makes; see decision
  // 0018's Consequences section for the argument and the real-data check of
  // how often it actually happens.

  // Determinism, re-checked against the synthetic artifact: the real-fixture
  // version of this test (above) has only three sprawling polities and no
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
 * Two ordinary, non-sprawling, non-aggregate polities whose bounding boxes
 * overlap in both axes during a shared year: the defect the owner reported
 * ("I think we should not have the same color on different polities that are
 * touching or close, I think it's disturbing") and the proximity graph
 * (`buildProximityGraph` in palette.ts) exists to close.
 *
 * These two exact ids are not arbitrary. `hash` (FNV-1a, palette.ts) is a
 * deterministic pure function of the id string, and "name:Neighbour 9" and
 * "name:Neighbour 18" were found (by running that exact function standalone)
 * to land on the identical bucket mod 40 -- both resolve to colour index 20,
 * `hsl(0 50% 42%)`, under the hash fallback alone. Before this revision's
 * proximity graph existed, two such polities placed in the same year with
 * overlapping territory had no mechanism stopping them from colliding
 * exactly like this pair does; picking an arbitrary pair could pass by
 * accident (most id pairs hash to different buckets) even with the fix
 * reverted, which is exactly the "test that could not fail" CLAUDE.md and
 * this task warn against. This pair cannot pass by accident: reverting the
 * proximity graph (or reverting to hash-only colouring for non-candidates)
 * makes this test fail, deterministically, on this exact pair.
 */
const NEIGHBOUR_A_ID = "name:Neighbour 9";
const NEIGHBOUR_B_ID = "name:Neighbour 18";

function buildProximityArtifact(): VersionsArtifact {
  const coordScale = 100_000;
  const rows: Version[] = [];
  const geometry: Record<string, VersionGeometry> = {};
  // Both non-sprawling (5 degrees, well under SPRAWL_THRESHOLD_DEGREES) and
  // identical, so they are guaranteed to overlap in both axes -- this test
  // is about proximity, not about the sprawl/co-visibility mechanism, so
  // neither polity qualifies for that graph on its own.
  const sharedBbox = makeGeometry(bboxSpanningDegrees(5, coordScale));

  rows.push(makeVersion(`${NEIGHBOUR_A_ID}@1900`, NEIGHBOUR_A_ID, 1900, 1950));
  geometry[`${NEIGHBOUR_A_ID}@1900`] = sharedBbox;
  rows.push(makeVersion(`${NEIGHBOUR_B_ID}@1900`, NEIGHBOUR_B_ID, 1900, 1950));
  geometry[`${NEIGHBOUR_B_ID}@1900`] = sharedBbox;

  return { schemaVersion: 1, level: "coarse", coordScale, rows, geometry };
}

describe("palette: proximity guarantee (synthetic artifact)", () => {
  // A wrong value here is the two ids' shared hash colour, hsl(0 50% 42%):
  // that is exactly what this test would report if the proximity graph were
  // deleted (or never consulted) and colourFor fell all the way through to
  // the hash fallback for both ids, since neither is sprawling or an
  // aggregate.
  it("gives two overlapping, non-sprawling neighbours different colours", () => {
    const palette = buildPalette(buildProximityArtifact());
    const a = palette.colourFor(NEIGHBOUR_A_ID);
    const b = palette.colourFor(NEIGHBOUR_B_ID);
    expect(a).not.toBe(b);
    // Names the specific collision this guards, not just "some" mismatch.
    expect([a, b]).not.toEqual(["hsl(0 50% 42%)", "hsl(0 50% 42%)"]);
  });

  it("builds the same colours twice from the same proximity artifact", () => {
    const synthetic = buildProximityArtifact();
    const first = buildPalette(synthetic);
    const second = buildPalette(synthetic);
    expect(second.colourFor(NEIGHBOUR_A_ID)).toBe(first.colourFor(NEIGHBOUR_A_ID));
    expect(second.colourFor(NEIGHBOUR_B_ID)).toBe(first.colourFor(NEIGHBOUR_B_ID));
  });
});

/**
 * A regression guard for the `memberOf ?? polityId` keying decision in
 * `buildProximityGraph`: two members of the same aggregate, whose bounding
 * boxes overlap each other and everything else in this artifact, must
 * collapse onto one drawn identity (the aggregate's) rather than compete for
 * two separate graph-coloured slots. If they did compete for separate slots,
 * "otherwise two members of the same empire will be treated as neighbours
 * needing different colours, which contradicts merged mode" (the risk this
 * keying exists to avoid).
 *
 * This is built to actually catch that mistake, not just assert the
 * post-merge colour equality colourForDraw already guarantees by
 * construction (colourForDraw's "on" branch looks up the aggregate's colour
 * unconditionally, so a same-colour assertion through colourForDraw alone
 * would pass even if the underlying graph keyed members by their own id).
 * Instead this sizes the artifact to make the *keying* itself observable:
 * one aggregate (whose own version, plus its two members' versions, must
 * collapse to a single proximity node under correct keying) plus 39
 * standalone polities, all sharing one identical bounding box and year
 * range -- a complete graph. Keyed correctly, that is exactly 40 distinct
 * drawn identities, fitting the 40-colour reservation with zero overflow
 * (confirmed below: no warning, exactly 40 distinct colours used). Keyed by
 * the raw polity id instead, the two members would add two *extra* nodes to
 * the same complete graph -- 42 distinct polity ids, all mutually
 * overlapping -- one confirmed real dist/ number past what greedy colouring
 * can fit in 40 (see the plain colour-reservation overflow test below for
 * the same pigeonhole argument at 41), which would make `warnOnOverflow`
 * fire. A wrong implementation here is caught by the warning firing, not by
 * a subtler colour-value mismatch.
 */
function buildMemberOverlapArtifact(): {
  artifact: VersionsArtifact;
  aggregateId: string;
  memberXId: string;
  memberYId: string;
  standaloneIds: string[];
} {
  const coordScale = 100_000;
  const rows: Version[] = [];
  const geometry: Record<string, VersionGeometry> = {};
  // Non-sprawling (5 degrees), so this exercises proximity alone, not the
  // separate co-visibility-forces-aggregates-in mechanism (which would force
  // the aggregate in regardless and could mask a proximity keying bug).
  const sharedGeometry = makeGeometry(bboxSpanningDegrees(5, coordScale));

  const aggregateId = "name:(Complete Empire)";
  rows.push(makeVersion(`${aggregateId}@1900`, aggregateId, 1900, 1950));
  geometry[`${aggregateId}@1900`] = sharedGeometry;

  const memberXId = "name:Complete Member X";
  const memberYId = "name:Complete Member Y";
  rows.push(makeVersion(`${memberXId}@1900`, memberXId, 1900, 1950, aggregateId));
  geometry[`${memberXId}@1900`] = sharedGeometry;
  rows.push(makeVersion(`${memberYId}@1900`, memberYId, 1900, 1950, aggregateId));
  geometry[`${memberYId}@1900`] = sharedGeometry;

  const standaloneIds: string[] = [];
  for (let i = 0; i < 39; i++) {
    const id = `name:Complete Standalone ${i}`;
    standaloneIds.push(id);
    rows.push(makeVersion(`${id}@1900`, id, 1900, 1950));
    geometry[`${id}@1900`] = sharedGeometry;
  }

  return {
    artifact: { schemaVersion: 2, level: "coarse", coordScale, rows, geometry },
    aggregateId,
    memberXId,
    memberYId,
    standaloneIds,
  };
}

describe("palette: member overlap does not fragment the proximity graph (synthetic artifact)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The keying guarantee itself: no overflow warning on an artifact sized to
  // overflow (42 mutually-overlapping ids) only if members were wrongly
  // keyed by their own polity id instead of their aggregate's.
  it("does not overflow when two overlapping members collapse onto their aggregate's node", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { artifact, aggregateId, standaloneIds } = buildMemberOverlapArtifact();
    const palette = buildPalette(artifact);
    expect(warn).not.toHaveBeenCalled();
    const colours = new Set(standaloneIds.map((id) => palette.colourFor(id)));
    colours.add(palette.colourFor(aggregateId));
    expect(colours.size).toBe(40);
  });

  // The observable rendering contract: both members still share their
  // aggregate's colour under merged mode despite their boxes overlapping
  // each other. A wrong value here is the two members resolving to two
  // different colours, e.g. distinct hash-fallback results.
  it("still shares a colour under merged mode for two overlapping members", () => {
    const { artifact, aggregateId, memberXId, memberYId } = buildMemberOverlapArtifact();
    const palette = buildPalette(artifact);
    const index = buildPolityIndex(artifact);
    const knownPolityIds = new Set(artifact.rows.map((r) => r.polityId));
    const aggregateParents = buildAggregateParents(artifact);
    const xEntry = index.get(`${memberXId}@1900`);
    const yEntry = index.get(`${memberYId}@1900`);
    expect(xEntry).toBeDefined();
    expect(yEntry).toBeDefined();
    const xColour = colourForDraw(
      xEntry as NonNullable<typeof xEntry>,
      "on",
      palette,
      knownPolityIds,
      aggregateParents,
    );
    const yColour = colourForDraw(
      yEntry as NonNullable<typeof yEntry>,
      "on",
      palette,
      knownPolityIds,
      aggregateParents,
    );
    expect(xColour).toBe(palette.colourFor(aggregateId));
    expect(yColour).toBe(palette.colourFor(aggregateId));
    expect(xColour).toBe(yColour);
  });
});

/**
 * Merged rendering (decision 0019): a version whose `memberOf` names an
 * aggregate renders with that aggregate's `colourFor` result, not an
 * independent colour of its own. `fixtures/dist` has zero rows with a
 * non-null `memberOf` (measured), so none of the tests above exercise this
 * at all -- a test suite that never built an artifact with real membership
 * could pass vacuously forever. This synthetic artifact, run through the
 * real `buildPalette` and the real `colourForDraw` together, is the only
 * place the merged path is checked end to end.
 */
function buildMergeArtifact(): {
  artifact: VersionsArtifact;
  aggregateId: string;
  memberId: string;
  soloId: string;
  danglingId: string;
} {
  const coordScale = 100_000;
  const rows: Version[] = [];
  const geometry: Record<string, VersionGeometry> = {};
  const smallBbox = makeGeometry(bboxSpanningDegrees(5, coordScale));

  const aggregateId = "name:(Test Empire)";
  rows.push(makeVersion(`${aggregateId}@1900`, aggregateId, 1900, 1950));
  geometry[`${aggregateId}@1900`] = smallBbox;

  const memberId = "name:Member Colony";
  rows.push(makeVersion(`${memberId}@1900`, memberId, 1900, 1950, aggregateId));
  geometry[`${memberId}@1900`] = smallBbox;

  // A wholly unrelated, unaffiliated polity, present in the same artifact so
  // a test can check the aggregate group's presence does not leak into it.
  const soloId = "name:Solo Colony";
  rows.push(makeVersion(`${soloId}@1900`, soloId, 1900, 1950));
  geometry[`${soloId}@1900`] = smallBbox;

  // A member whose memberOf names a polity that is not itself a row in this
  // artifact -- the dangling-reference case decision 0017 measures at zero
  // against real data but colourForDraw must not assume stays true forever.
  const danglingId = "name:Dangling Colony";
  rows.push(makeVersion(`${danglingId}@1900`, danglingId, 1900, 1950, "name:(Ghost Empire)"));
  geometry[`${danglingId}@1900`] = smallBbox;

  return {
    artifact: { schemaVersion: 2, level: "coarse", coordScale, rows, geometry },
    aggregateId,
    memberId,
    soloId,
    danglingId,
  };
}

describe("colourForDraw: merged mode (synthetic artifact, real palette)", () => {
  // The one behaviour "on" mode exists for, exercised end to end through the
  // real graph/hash palette rather than a fake one. A wrong value here --
  // the member falling through to its own colourFor result instead of the
  // aggregate's -- would return the member's own (different, since they are
  // different ids hashed independently) colour instead.
  it("resolves a member to its aggregate's real palette colour", () => {
    const { artifact, aggregateId, memberId } = buildMergeArtifact();
    const palette = buildPalette(artifact);
    const index = buildPolityIndex(artifact);
    const knownPolityIds = new Set(artifact.rows.map((r) => r.polityId));
    const aggregateParents = buildAggregateParents(artifact);
    const entry = index.get(`${memberId}@1900`);
    expect(entry).toBeDefined();
    const colour = colourForDraw(
      entry as NonNullable<typeof entry>,
      "on",
      palette,
      knownPolityIds,
      aggregateParents,
    );
    expect(colour).toBe(palette.colourFor(aggregateId));
  });

  // A non-member is unaffected by the presence of an aggregate group in the
  // same artifact: built alongside "Test Empire" and its one member, "Solo
  // Colony" still resolves to exactly its own colourFor result. A wrong
  // value here would mean the aggregate/member bookkeeping is leaking into
  // an unaffiliated polity's draw colour.
  it("leaves a non-member's colour unaffected by an aggregate group in the same artifact", () => {
    const { artifact, soloId } = buildMergeArtifact();
    const palette = buildPalette(artifact);
    const index = buildPolityIndex(artifact);
    const knownPolityIds = new Set(artifact.rows.map((r) => r.polityId));
    const aggregateParents = buildAggregateParents(artifact);
    const entry = index.get(`${soloId}@1900`);
    expect(entry).toBeDefined();
    const colour = colourForDraw(
      entry as NonNullable<typeof entry>,
      "on",
      palette,
      knownPolityIds,
      aggregateParents,
    );
    expect(colour).toBe(palette.colourFor(soloId));
  });

  // The dangling-reference safety net, run through the real palette: a
  // member whose memberOf names a polity absent from this artifact's rows
  // must fall back to its own colour rather than crash or colour by a name
  // that draws nothing. A wrong value here would be a thrown error (palette
  // asked to look up an id it never assigned a graph colour to still returns
  // a hash colour, so this would not throw from the palette itself -- the
  // crash this guards is colourForDraw handing colourFor a dangling id at
  // all) or a colour computed from "name:(Ghost Empire)" instead of from
  // "name:Dangling Colony".
  it("falls back to a member's own colour when memberOf is unknown, without crashing", () => {
    const { artifact, danglingId } = buildMergeArtifact();
    const palette = buildPalette(artifact);
    const index = buildPolityIndex(artifact);
    const knownPolityIds = new Set(artifact.rows.map((r) => r.polityId));
    const aggregateParents = buildAggregateParents(artifact);
    const entry = index.get(`${danglingId}@1900`);
    expect(entry).toBeDefined();
    expect(() =>
      colourForDraw(
        entry as NonNullable<typeof entry>,
        "on",
        palette,
        knownPolityIds,
        aggregateParents,
      ),
    ).not.toThrow();
    const colour = colourForDraw(
      entry as NonNullable<typeof entry>,
      "on",
      palette,
      knownPolityIds,
      aggregateParents,
    );
    expect(colour).toBe(palette.colourFor(danglingId));
  });
});

/**
 * 41 sprawling polities (one more than the palette's 40-colour reservation),
 * all mutually co-visible (same 1900-1950 year range for every one of them),
 * so the co-visibility graph is a complete graph on 41 nodes. Greedy
 * colouring a complete graph always needs exactly as many colours as nodes
 * -- every pair is adjacent, so no two can ever share an index -- which
 * forces colour indices 0..40, one past the 40 reserved.
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

describe("palette: colour-reservation overflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The 40-colour reservation has never been exceeded against real data (see
  // the report this shipped with), so nothing else in this suite exercises
  // `warnOnOverflow`. An
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
    // in colourFromIndex necessarily collides colour index 40 with index 0,
    // so not all 41 colours can be distinct. If this ever started passing
    // with 41 distinct colours, the 40-colour reservation would have
    // silently grown and this test would no longer be exercising the
    // overflow path at all.
    expect(new Set(colours).size).toBeLessThan(OVERFLOW_IDS.length);
  });
});
