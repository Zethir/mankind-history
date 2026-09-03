import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COORD_SCALE, type Manifest, readArtifact, type VersionsArtifact } from "@history/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceSpec } from "../src/sources";
import { emit } from "../src/stages/emit";

const source: SourceSpec = {
  dataset: "cliopatria",
  name: "Cliopatria (Seshat Global History Databank)",
  license: "CC-BY-4.0",
  upstreamVersion: "1.0.0",
  url: "https://example.invalid/c.zip",
  file: "c.zip",
  sha256: "a".repeat(64),
};

function input(outDir: string) {
  return {
    outDir,
    polities: [
      {
        id: "wd:Q1",
        name: "P",
        normalizedName: "p",
        wikidata: "Q1",
        wikipedia: null,
        seshat: null,
      },
    ],
    versions: [
      {
        id: "wd:Q1@0",
        polityId: "wd:Q1",
        fromYear: 0,
        toYear: 100,
        area: 5,
        prevId: null,
        delta: null,
        gap: null,
        confidence: null,
        source: { dataset: "cliopatria" as const, version: "1.0.0" },
      },
    ],
    geometry: {
      "wd:Q1@0": {
        polygons: [[[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]]],
        bbox: [0, 0, 10, 10] as [number, number, number, number],
        anchor: [5, 5] as [number, number],
      },
    },
    land: { coarse: [[[0, 0, 1, 0, 1, 1, 0, 0]]], mid: [[[0, 0, 2, 0, 2, 2, 0, 0]]] },
    sources: [source],
  };
}

describe("emit", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "emit-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the Milestone 1 artifact set", () => {
    emit(input(dir));
    for (const file of [
      "polities.json",
      "versions.2.json",
      "land.0.json",
      "land.1.json",
      "manifest.json",
    ]) {
      expect(readFileSync(join(dir, file), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("stamps the versions artifact with its level and coordinate scale", () => {
    emit(input(dir));
    const artifact = readArtifact<VersionsArtifact>(join(dir, "versions.2.json"));
    expect(artifact.level).toBe("full");
    expect(artifact.coordScale).toBe(COORD_SCALE.full);
    expect(artifact.rows).toHaveLength(1);
    expect(artifact.geometry["wd:Q1@0"]?.anchor).toEqual([5, 5]);
  });

  it("names every source with its upstream version and licence", () => {
    emit(input(dir));
    const manifest = readArtifact<Manifest>(join(dir, "manifest.json"));
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]).toMatchObject({
      dataset: "cliopatria",
      license: "CC-BY-4.0",
      upstreamVersion: "1.0.0",
      sha256: "a".repeat(64),
    });
  });

  it("records size and checksum for every artifact except the manifest itself", () => {
    const manifest = emit(input(dir));
    const files = manifest.artifacts.map((a) => a.file);
    expect(files).toEqual(["land.0.json", "land.1.json", "polities.json", "versions.2.json"]);
    for (const artifact of manifest.artifacts) {
      expect(artifact.bytes).toBeGreaterThan(0);
      expect(artifact.gzipBytes).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("writes no wall-clock time anywhere in the output", () => {
    emit(input(dir));
    for (const file of ["manifest.json", "polities.json", "versions.2.json"]) {
      const raw = readFileSync(join(dir, file), "utf8");
      expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it("refuses to emit against an unpinned source", () => {
    const unpinned = { ...input(dir), sources: [{ ...source, sha256: null }] };
    expect(() => emit(unpinned)).toThrow(/unpinned/i);
  });
});
