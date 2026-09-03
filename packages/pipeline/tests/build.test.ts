import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest, VersionsArtifact } from "@history/model";
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
        feature({ Name: "Beta", FromYear: -50, ToYear: 20 }, 20, 20),
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

  it("produces the Milestone 1 artifact set end to end", () => {
    const report = build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    expect(report.normalise.kept).toBe(3);
    expect(report.normalise.droppedNonPolity).toBe(1);
    expect(report.polities).toBe(2);
    expect(report.versions).toBe(3);

    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    expect(Object.keys(versions.geometry)).toHaveLength(3);
    const second = versions.rows.find((r) => r.id === "name:Alpha@150");
    expect(second?.prevId).toBe("name:Alpha@0");
    expect(second?.gap).toBe(50);
  });

  it("attaches geometry to every version it emits", () => {
    build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    for (const row of versions.rows) {
      expect(versions.geometry[row.id]).toBeDefined();
    }
  });

  it("copies source provenance into the manifest", () => {
    build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
    expect(manifest.sources.map((s) => s.dataset).sort()).toEqual([
      "cliopatria",
      "naturalEarth110mLand",
      "naturalEarth50mLand",
    ]);
  });
});
