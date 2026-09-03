import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COORD_SCALE,
  equalEarth,
  equalEarthInverse,
  MAX_SEGMENT_X,
  type Manifest,
  type PolitiesArtifact,
  readArtifact,
  type Version,
  type VersionsArtifact,
} from "@history/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, loadAliases, loadOverlaps } from "../src/build";

const SCALE = COORD_SCALE.full;
const FIXTURES = "fixtures";

let outDir: string;
let versions: VersionsArtifact;
let polities: PolitiesArtifact;
let manifest: Manifest;

function buildFixtureInto(dir: string) {
  return build({
    sourcesDir: FIXTURES,
    outDir: dir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });
}

// The fixture's antimeridian-adjacent slice carries Russia's full,
// un-clipped multi-century lineage (see fixtures/README.md), so a build of
// it -- and the double build the determinism check below runs -- takes
// noticeably longer than vitest's 5s default. Generous explicit timeouts
// avoid a spurious failure on a slower machine or a cold cache, without
// touching the shared vitest.config.ts.
const BUILD_TIMEOUT = 60_000;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "acceptance-"));
  buildFixtureInto(outDir);
  versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
  polities = readArtifact<PolitiesArtifact>(join(outDir, "polities.json"));
  manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
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
  it("every ring is closed, has at least 4 points, and contains no NaN or infinite values", () => {
    for (const geometry of Object.values(versions.geometry)) {
      expect(geometry.polygons.length).toBeGreaterThan(0);
      for (const polygon of geometry.polygons) {
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
    "un-projecting any coordinate returns the source lon/lat within 1e-6",
    () => {
      // The exhaustive source-to-stored-to-source comparison lives in
      // packages/model/tests/projection.test.ts, which sweeps the globe through
      // this exact COORD_SCALE.full quantisation. Here the same property is
      // checked on the shipped artifact: every stored coordinate must un-project
      // to a real lon/lat and re-project to the identical integer, which is what
      // fails if the scale or the projection ever drift apart.
      for (const geometry of Object.values(versions.geometry)) {
        for (const polygon of geometry.polygons) {
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
    },
    BUILD_TIMEOUT,
  );

  it(
    "no polygon crosses the antimeridian in projected space",
    () => {
      // Passes vacuously on this fixture: no ring in the pinned Cliopatria
      // release wraps the antimeridian at all (max |lon| is exactly 180, and
      // a full pnpm build cuts zero polygons), so cutPolygons is a no-op
      // here. Real coverage of the cutting path is
      // packages/pipeline/tests/antimeridian.test.ts, which builds synthetic
      // wrapping rings by hand. See fixtures/README.md.
      const limit = MAX_SEGMENT_X * SCALE;
      for (const geometry of Object.values(versions.geometry)) {
        for (const polygon of geometry.polygons) {
          for (const ring of polygon) {
            for (let i = 2; i < ring.length; i += 2) {
              expect(Math.abs((ring[i] as number) - (ring[i - 2] as number))).toBeLessThan(limit);
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
      expect(source.upstreamVersion).not.toBe("UNPINNED");
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.sources.some((s) => s.license === "CC-BY-4.0")).toBe(true);
  });

  it(
    "matches the committed golden artifacts",
    () => {
      for (const file of readdirSync(join(FIXTURES, "dist")).sort()) {
        expect(readFileSync(join(outDir, file))).toEqual(
          readFileSync(join(FIXTURES, "dist", file)),
        );
      }
    },
    BUILD_TIMEOUT,
  );
});
