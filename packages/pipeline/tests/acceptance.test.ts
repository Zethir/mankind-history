import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COORD_SCALE,
  equalEarth,
  equalEarthInverse,
  type LandArtifact,
  MAX_SEGMENT_X,
  type Manifest,
  type PolitiesArtifact,
  type Polygon,
  type Version,
  type VersionsArtifact,
} from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, loadAliases, loadOverlaps } from "../src/build";

const SCALE = COORD_SCALE.full;
const FIXTURES = "fixtures";

let outDir: string;
let versions: VersionsArtifact;
let polities: PolitiesArtifact;
let manifest: Manifest;
let landCoarse: LandArtifact;
let landMid: LandArtifact;

function buildFixtureInto(dir: string) {
  return build({
    sourcesDir: FIXTURES,
    outDir: dir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });
}

/** Every polygon group in the artifact set: one per version, plus both land levels. */
function allPolygonGroups(): Polygon[][] {
  return [
    ...Object.values(versions.geometry).map((g) => g.polygons),
    landCoarse.polygons,
    landMid.polygons,
  ];
}

// A generous explicit timeout guards the fixture build -- and the double
// build the determinism check below runs -- against a slower machine or a
// cold cache, without touching the shared vitest.config.ts default of 5s.
// (An earlier fixture selector kept antimeridian-adjacent geometry, which
// pulled in Russia's full multi-century lineage; that selector is gone --
// see fixtures/README.md -- so this headroom is no longer load-bearing, just
// cheap insurance.)
const BUILD_TIMEOUT = 60_000;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "acceptance-"));
  buildFixtureInto(outDir);
  versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
  polities = readArtifact<PolitiesArtifact>(join(outDir, "polities.json"));
  manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
  landCoarse = readArtifact<LandArtifact>(join(outDir, "land.0.json"));
  landMid = readArtifact<LandArtifact>(join(outDir, "land.1.json"));
}, BUILD_TIMEOUT);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const byId = () => new Map(versions.rows.map((v) => [v.id, v] as const));

describe("lineage", () => {
  it("every version has non-null prev_id, delta and gap, except first appearances which have all three null", () => {
    for (const v of versions.rows) {
      const nulls = [v.prevId, v.delta, v.gap].filter((x) => x === null).length;
      expect(nulls === 0 || nulls === 3).toBe(true);
    }
  });

  it("no polity has two versions with the same from_year", () => {
    const seen = new Set<string>();
    for (const v of versions.rows) {
      const key = `${v.polityId}@${v.fromYear}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("overlapping versions of one polity are zero, or explicitly whitelisted with a reason", () => {
    const whitelisted = new Set(
      loadOverlaps("packages/pipeline/overlaps.json").map((o) => `${o.earlier}|${o.later}`),
    );
    for (const o of loadOverlaps("packages/pipeline/overlaps.json")) {
      expect(o.reason.trim().length).toBeGreaterThan(0);
    }
    const index = byId();
    for (const v of versions.rows) {
      if (v.prevId === null) continue;
      const prev = index.get(v.prevId) as Version;
      if (v.fromYear <= prev.toYear) {
        expect(whitelisted.has(`${prev.id}|${v.id}`)).toBe(true);
      }
    }
  });

  it("delta equals area minus prev.area for every non-first version", () => {
    const index = byId();
    for (const v of versions.rows) {
      if (v.prevId === null) continue;
      const prev = index.get(v.prevId) as Version;
      expect(v.delta).toBeCloseTo(v.area - prev.area, 9);
      expect(v.gap).toBe(Math.max(0, v.fromYear - prev.toYear));
    }
  });
});

describe("geometry", () => {
  it("every ring is closed, has at least 4 points, and contains no NaN or infinite values (versions and both land levels)", () => {
    for (const polygons of allPolygonGroups()) {
      expect(polygons.length).toBeGreaterThan(0);
      for (const polygon of polygons) {
        for (const ring of polygon) {
          expect(ring.length % 2).toBe(0);
          expect(ring.length / 2).toBeGreaterThanOrEqual(4);
          expect(ring.every(Number.isFinite)).toBe(true);
          expect(ring[0]).toBe(ring[ring.length - 2]);
          expect(ring[1]).toBe(ring[ring.length - 1]);
        }
      }
    }
  });

  it(
    "un-projecting any coordinate returns the source lon/lat within 1e-6 (versions and both land levels)",
    () => {
      // The exhaustive source-to-stored-to-source comparison lives in
      // packages/model/tests/projection.test.ts, which sweeps the globe through
      // this exact COORD_SCALE.full quantisation. Here the same property is
      // checked on the shipped artifact: every stored coordinate must un-project
      // to a real lon/lat and re-project to the identical integer, which is what
      // fails if the scale or the projection ever drift apart. Land is stored at
      // its own coarser coordScale, not COORD_SCALE.full, so it is checked
      // separately below against the scale its own artifact declares.
      for (const polygons of Object.values(versions.geometry).map((g) => g.polygons)) {
        for (const polygon of polygons) {
          for (const ring of polygon) {
            for (let i = 0; i < ring.length; i += 2) {
              const x = (ring[i] as number) / SCALE;
              const y = (ring[i + 1] as number) / SCALE;
              const [lon, lat] = equalEarthInverse(x, y);
              expect(Math.abs(lon)).toBeLessThanOrEqual(180.000001);
              expect(Math.abs(lat)).toBeLessThanOrEqual(90.000001);
              const [rx, ry] = equalEarth(lon, lat);
              expect(Math.abs(Math.round(rx * SCALE) - (ring[i] as number))).toBeLessThanOrEqual(1);
              expect(
                Math.abs(Math.round(ry * SCALE) - (ring[i + 1] as number)),
              ).toBeLessThanOrEqual(1);
            }
          }
        }
      }
      // Land is quantised much coarser than versions (coordScale 1e5 and 1e6
      // against COORD_SCALE.full's 1e9), so the same absolute 1e-6-degree
      // bound does not apply -- one quantisation step alone is bigger than
      // that near the map's edge. The round-trip-to-the-same-integer property
      // still must hold at any scale; the degree bound scales down with it,
      // linearly against COORD_SCALE.full, with headroom over what is
      // actually measured on the shipped artifacts (coarse: ~7.2e-4 degrees
      // worst case against a 1e-2 bound here; mid: ~1.1e-4 against 1e-3).
      for (const land of [landCoarse, landMid]) {
        const landScale = land.coordScale;
        const degreeBound = 1e-6 * (SCALE / landScale);
        for (const polygon of land.polygons) {
          for (const ring of polygon) {
            for (let i = 0; i < ring.length; i += 2) {
              const x = (ring[i] as number) / landScale;
              const y = (ring[i + 1] as number) / landScale;
              const [lon, lat] = equalEarthInverse(x, y);
              expect(Math.abs(lon)).toBeLessThanOrEqual(180 + degreeBound);
              expect(Math.abs(lat)).toBeLessThanOrEqual(90 + degreeBound);
              const [rx, ry] = equalEarth(lon, lat);
              expect(
                Math.abs(Math.round(rx * landScale) - (ring[i] as number)),
              ).toBeLessThanOrEqual(1);
              expect(
                Math.abs(Math.round(ry * landScale) - (ring[i + 1] as number)),
              ).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    },
    BUILD_TIMEOUT,
  );

  it(
    "no polygon crosses the antimeridian in projected space (versions and both land levels)",
    () => {
      // Passes on the fixture's versions for the same reason it always did: no
      // ring in the pinned Cliopatria release wraps the antimeridian at all
      // (max |lon| is exactly 180, and a full pnpm build cuts zero polygons on
      // that source), so cutPolygons is a no-op there. Land is not vacuous the
      // same way: Natural Earth's Antarctica ring steps across the pole line at
      // lon 180/-180, which is a real wide segment in projected space and is
      // exactly the shape the Antarctica bug got wrong (see
      // docs/decisions/0012-antimeridian-cutting.md and
      // packages/pipeline/tests/antimeridian.test.ts, which covers the cutting
      // path directly with synthetic rings, including that polar-cap case).
      const limit = MAX_SEGMENT_X * SCALE;
      for (const polygons of Object.values(versions.geometry).map((g) => g.polygons)) {
        for (const polygon of polygons) {
          for (const ring of polygon) {
            for (let i = 2; i < ring.length; i += 2) {
              expect(Math.abs((ring[i] as number) - (ring[i - 2] as number))).toBeLessThan(limit);
            }
          }
        }
      }
      for (const land of [landCoarse, landMid]) {
        const landLimit = MAX_SEGMENT_X * land.coordScale;
        for (const polygon of land.polygons) {
          for (const ring of polygon) {
            for (let i = 2; i < ring.length; i += 2) {
              expect(Math.abs((ring[i] as number) - (ring[i - 2] as number))).toBeLessThan(
                landLimit,
              );
            }
          }
        }
      }
    },
    BUILD_TIMEOUT,
  );
});

describe("identity and honesty", () => {
  it("polity identity keys on the upstream name, not on the reused wikidata id (decision 0011)", () => {
    for (const p of polities.polities) {
      expect(p.id).toBe(`name:${p.name}`);
    }
    // Wikidata is stored metadata, and the same id legitimately appears on
    // several distinct polities -- Q7462 covers Song, Northern Song and
    // Southern Song. Identity must survive that rather than merge them.
    const ids = new Set(polities.polities.map((p) => p.id));
    expect(ids.size).toBe(polities.polities.length);
  });

  it("confidence is unpopulated, because it has no licensed source (decision 0005)", () => {
    for (const v of versions.rows) expect(v.confidence).toBeNull();
  });
});

describe("build", () => {
  it(
    "is deterministic: identical inputs produce byte-identical outputs",
    () => {
      const second = mkdtempSync(join(tmpdir(), "acceptance-2-"));
      try {
        buildFixtureInto(second);
        const files = readdirSync(outDir).sort();
        expect(readdirSync(second).sort()).toEqual(files);
        for (const file of files) {
          expect(readFileSync(join(second, file))).toEqual(readFileSync(join(outDir, file)));
        }
      } finally {
        rmSync(second, { recursive: true, force: true });
      }
    },
    BUILD_TIMEOUT,
  );

  it("the manifest names every source with its upstream version and licence", () => {
    expect(manifest.sources.length).toBeGreaterThanOrEqual(3);
    for (const source of manifest.sources) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.license.length).toBeGreaterThan(0);
      expect(source.upstreamVersion.length).toBeGreaterThan(0);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.sources.some((s) => s.license === "CC-BY-4.0")).toBe(true);
  });

  it(
    "matches the committed golden artifacts",
    () => {
      // Compare the file lists both ways: iterating the golden directory
      // alone would pass if it were emptied, and would never notice the
      // build emitting an extra file the golden directory does not have.
      const goldenFiles = readdirSync(join(FIXTURES, "dist")).sort();
      const builtFiles = readdirSync(outDir).sort();
      expect(builtFiles).toEqual(goldenFiles);
      for (const file of goldenFiles) {
        expect(readFileSync(join(outDir, file))).toEqual(
          readFileSync(join(FIXTURES, "dist", file)),
        );
      }
    },
    BUILD_TIMEOUT,
  );
});
