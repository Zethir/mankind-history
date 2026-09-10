import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChangesArtifact, Manifest, VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build } from "../src/build";

const ring = (cx: number, cy: number) => [
  [cx, cy],
  [cx + 2, cy],
  [cx + 2, cy + 2],
  [cx, cy + 2],
  [cx, cy],
];

function collection(features: unknown[]) {
  return JSON.stringify({ type: "FeatureCollection", features });
}

function feature(props: Record<string, unknown>, cx: number, cy: number) {
  return {
    type: "Feature",
    properties: { Type: "POLITY", Area: 1, ...props },
    geometry: { type: "Polygon", coordinates: [ring(cx, cy)] },
  };
}

describe("build", () => {
  let sourcesDir: string;
  let outDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "build-"));
    sourcesDir = join(root, "sources");
    outDir = join(root, "dist");
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(sourcesDir, "cliopatria_polities_only.geojson"),
      collection([
        feature({ Name: "Alpha", Wikidata: "Q1", FromYear: 0, ToYear: 100 }, 0, 0),
        feature({ Name: "Alpha", Wikidata: "Q1", FromYear: 150, ToYear: 200 }, 1, 1),
        feature({ Name: "Beta", MemberOf: "Alpha", FromYear: -50, ToYear: 20 }, 20, 20),
        {
          ...feature({ Name: "Rel", FromYear: 0, ToYear: 1 }, 5, 5),
          properties: { Type: "RELATION" },
        },
      ]),
    );
    const land = collection([
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(0, 0)] } },
    ]);
    writeFileSync(join(sourcesDir, "ne_110m_land.geojson"), land);
    writeFileSync(join(sourcesDir, "ne_50m_land.geojson"), land);
  });

  afterEach(() => {
    rmSync(join(sourcesDir, ".."), { recursive: true, force: true });
  });

  it("produces the Milestone 1 artifact set end to end", async () => {
    const report = await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    expect(report.normalise.kept).toBe(3);
    expect(report.normalise.droppedNonPolity).toBe(1);
    expect(report.polities).toBe(2);
    expect(report.versions).toBe(3);

    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    expect(Object.keys(versions.geometry)).toHaveLength(3);
    const second = versions.rows.find((r) => r.id === "name:Alpha@150");
    expect(second?.prevId).toBe("name:Alpha@0");
    expect(second?.gap).toBe(50);

    // Beta's MemberOf ("Alpha") resolves end to end through the real pipeline,
    // not just through resolveMembership in isolation. See decision 0017.
    const beta = versions.rows.find((r) => r.id === "name:Beta@-50");
    expect(beta?.memberOf).toBe("name:Alpha");
    expect(second?.memberOf).toBeNull();
    expect(report.membership).toEqual({ withMemberOf: 1, distinctAggregates: 1 });
  });

  it("fails the build on a MemberOf name that dangles, end to end", async () => {
    writeFileSync(
      join(sourcesDir, "cliopatria_polities_only.geojson"),
      collection([
        feature({ Name: "Orphan", MemberOf: "No Such Polity", FromYear: 0, ToYear: 10 }, 40, 40),
        feature({ Name: "Filler", FromYear: 0, ToYear: 10 }, 60, 60),
      ]),
    );
    await expect(build({ sourcesDir, outDir, aliases: [], overlaps: [] })).rejects.toThrow(
      /No Such Polity/,
    );
  });

  it("attaches geometry to every version it emits", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    for (const row of versions.rows) {
      expect(versions.geometry[row.id]).toBeDefined();
    }
  });

  it("copies source provenance into the manifest", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
    expect(manifest.sources.map((s) => s.dataset).sort()).toEqual([
      "cliopatria",
      "naturalEarth110mLand",
      "naturalEarth50mLand",
    ]);
  });

  it("emits all three levels and a change index", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    for (const f of ["versions.0.json", "versions.1.json", "versions.2.json", "changes.json"]) {
      expect(readFileSync(join(outDir, f), "utf8").length).toBeGreaterThan(0);
    }
    const changes = readArtifact<ChangesArtifact>(join(outDir, "changes.json"));
    expect(changes.cells).toHaveLength(changes.grid.cols * changes.grid.rows);
    expect(changes.cells.flat().length).toBeGreaterThan(0);
  });

  it("simplifies coarser levels without losing any version", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const full = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    const coarse = readArtifact<VersionsArtifact>(join(outDir, "versions.0.json"));
    expect(Object.keys(coarse.geometry).sort()).toEqual(Object.keys(full.geometry).sort());
    for (const g of Object.values(coarse.geometry)) expect(g.polygons.length).toBeGreaterThan(0);
  });
});
