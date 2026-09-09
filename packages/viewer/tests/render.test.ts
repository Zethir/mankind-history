import type { PolitiesArtifact, Version, VersionGeometry, VersionsArtifact } from "@history/model";
import { COORD_SCALE, equalEarth, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPalette } from "../src/render/palette";
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
  // polity whose colour moved, rather than passing silently. Verified by
  // temporarily changing FAMILIES[0]'s hue from 0 to 5 -- see the report
  // this shipped with for both the failing and the restored-green run.
  //
  // Regenerated for the 1970s family palette (decision 0018). Three of these
  // twelve fixture polities qualify as sprawling (a version bounding box
  // spanning more than 45 degrees of longitude): Eastern Roman Empire
  // (Justinian's African and Italian reconquest, 536-554, spans ~47
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
  // colours (family 0 vs family 1) below.
  it("matches the committed golden colours for the fixture's polities", () => {
    const golden: Record<string, string> = {
      "name:Eastern Roman Empire": "hsl(0 50% 74%)",
      "name:Etruscans": "hsl(45 50% 58%)",
      "name:Kingdom of Italy": "hsl(0 50% 74%)",
      "name:Nazi Germany": "hsl(22 30% 74%)",
      "name:Ostrogothic Kingdom": "hsl(25 50% 74%)",
      "name:Papal States": "hsl(180 26% 58%)",
      "name:Republic of Italy": "hsl(0 50% 28%)",
      "name:Roman Kingdom": "hsl(45 50% 74%)",
      "name:Roman Republic": "hsl(200 26% 58%)",
      "name:Vandal Kingdom": "hsl(150 26% 74%)",
      "name:Visigoths": "hsl(180 26% 74%)",
      "name:Western Roman Empire": "hsl(40 55% 28%)",
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
    const entry = index.get(`${memberId}@1900`);
    expect(entry).toBeDefined();
    const colour = colourForDraw(entry as NonNullable<typeof entry>, "on", palette, knownPolityIds);
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
    const entry = index.get(`${soloId}@1900`);
    expect(entry).toBeDefined();
    const colour = colourForDraw(entry as NonNullable<typeof entry>, "on", palette, knownPolityIds);
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
    const entry = index.get(`${danglingId}@1900`);
    expect(entry).toBeDefined();
    expect(() =>
      colourForDraw(entry as NonNullable<typeof entry>, "on", palette, knownPolityIds),
    ).not.toThrow();
    const colour = colourForDraw(entry as NonNullable<typeof entry>, "on", palette, knownPolityIds);
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
