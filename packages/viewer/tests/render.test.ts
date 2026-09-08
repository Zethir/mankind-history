import type { PolitiesArtifact, VersionsArtifact } from "@history/model";
import { COORD_SCALE, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
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

  // Building the palette twice from the same artifact must be byte-identical
  // for every polity. Colour is no longer a pure function of the id alone
  // (decision 0016: it also depends on every other polity's position in this
  // artifact), so this is a separate guarantee from the self-equality test
  // above -- it is the one that would catch, say, a Map iteration order
  // dependency or a sort that is not a total order.
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
  // vector is the deliberate diff: a feel-session tweak to SATURATION,
  // LIGHTNESS or the hash function shows up here as a failing object-diff
  // naming every polity whose colour moved, rather than passing silently.
  // Verified by temporarily changing SATURATION from 55 to 50: all twelve
  // entries showed up as mismatched (wrong "50%" instead of "55%") in the
  // single toEqual diff below, then reverted.
  //
  // Regenerated for decision 0016's geographic-hue palette. With exactly 12
  // polities in this fixture and PALETTE_HUES = 12, every polity lands in its
  // own hue band (rank and hue index coincide 0..11), sorted by each
  // polity's earliest-version anchor x ascending: Western Roman Empire
  // (x=-6101) through Eastern Roman Empire (x=44913).
  it("matches the committed golden colours for the fixture's polities", () => {
    const golden: Record<string, string> = {
      "name:Western Roman Empire": "hsl(0 55% 40%)",
      "name:Nazi Germany": "hsl(30 55% 72%)",
      "name:Vandal Kingdom": "hsl(60 55% 56%)",
      "name:Kingdom of Italy": "hsl(90 55% 72%)",
      "name:Republic of Italy": "hsl(120 55% 72%)",
      "name:Ostrogothic Kingdom": "hsl(150 55% 72%)",
      "name:Etruscans": "hsl(180 55% 40%)",
      "name:Roman Kingdom": "hsl(210 55% 72%)",
      "name:Roman Republic": "hsl(240 55% 40%)",
      "name:Visigoths": "hsl(270 55% 40%)",
      "name:Papal States": "hsl(300 55% 72%)",
      "name:Eastern Roman Empire": "hsl(330 55% 72%)",
    };
    const palette = buildPalette(versions);
    const actual: Record<string, string> = {};
    for (const p of polities) actual[p.id] = palette.colourFor(p.id);
    // One object-level assertion, so a mismatch reports every affected
    // polity's id and colour at once instead of stopping at the first.
    expect(actual).toEqual(golden);
  });

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

  // The point of decision 0016: hue is seeded from longitude, so it must vary
  // *with* geography rather than at random. This is the assertion that
  // matters most in this file -- it is written to fail against the exact
  // wrong implementation this change replaces.
  //
  // Sort the fixture's 12 polities by their earliest version's anchor x
  // (ascending, ties on polity id -- the same rule buildPalette itself uses)
  // and read the hue out of each resolved colour. Because hueIndex is
  // assigned by rank, that sequence of hues is non-decreasing by
  // construction whenever, as here, every polity gets its own hue band.
  //
  // The OLD hash-based colourFor(polityId) -- hue = (hash(id) % 16) * 360/16,
  // uncorrelated with position -- fails this on the very same fixture: in
  // anchor-x order its hues are
  // [22.5, 292.5, 157.5, 202.5, 315, 225, 315, 90, 67.5, 180, 45, 337.5],
  // which drops from 22.5 to 292.5 between the first two entries alone. That
  // is the concrete wrong implementation this test is built to catch -- a
  // colour keyed on the id's hash with no relationship to where the polity
  // actually is.
  it("assigns hue in the same order as geography, not at random", () => {
    const earliest = new Map<string, { versionId: string; fromYear: number }>();
    for (const row of versions.rows) {
      const current = earliest.get(row.polityId);
      if (
        !current ||
        row.fromYear < current.fromYear ||
        (row.fromYear === current.fromYear && row.id < current.versionId)
      ) {
        earliest.set(row.polityId, { versionId: row.id, fromYear: row.fromYear });
      }
    }
    const byAnchorX = polities
      .map((p) => {
        const entry = earliest.get(p.id);
        expect(entry, p.id).toBeDefined();
        const anchor = versions.geometry[(entry as { versionId: string }).versionId]?.anchor;
        expect(anchor, p.id).toBeDefined();
        return { id: p.id, x: (anchor as [number, number])[0] };
      })
      .sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const palette = buildPalette(versions);
    const hues = byAnchorX.map(({ id }) => {
      const match = /^hsl\((\d+(?:\.\d+)?) /.exec(palette.colourFor(id));
      expect(match, id).not.toBeNull();
      return Number.parseFloat((match as RegExpExecArray)[1] as string);
    });

    for (let i = 1; i < hues.length; i++) {
      expect(
        hues[i],
        `${byAnchorX[i]?.id} should not have a lower hue than ${byAnchorX[i - 1]?.id}`,
      ).toBeGreaterThanOrEqual(hues[i - 1] as number);
    }
  });
});
