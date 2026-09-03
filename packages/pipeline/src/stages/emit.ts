import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  COORD_SCALE,
  type LandArtifact,
  type Manifest,
  type ManifestArtifact,
  type ManifestSource,
  type PolitiesArtifact,
  type Polity,
  type Polygon,
  PROJECTION,
  SCHEMA_VERSION,
  type Version,
  type VersionGeometry,
  type VersionsArtifact,
  writeArtifact,
} from "@history/model";
import type { SourceSpec } from "../sources";

export interface EmitInput {
  outDir: string;
  polities: Polity[];
  versions: Version[];
  geometry: Record<string, VersionGeometry>;
  land: { coarse: Polygon[]; mid: Polygon[] };
  sources: SourceSpec[];
}

function measure(outDir: string, file: string): ManifestArtifact {
  const buf = readFileSync(join(outDir, file));
  return {
    file,
    bytes: buf.length,
    gzipBytes: gzipSync(buf, { level: 9 }).length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

/**
 * Write the Milestone 1 artifact set, then the manifest that describes it.
 *
 * The manifest deliberately carries no build time. Provenance is the upstream
 * versions and checksums, which are properties of the inputs; a timestamp is a
 * property of the run and would break byte-identical output. See ADR 0010.
 */
export function emit(input: EmitInput): Manifest {
  mkdirSync(input.outDir, { recursive: true });

  const sources: ManifestSource[] = input.sources
    .map((spec) => {
      if (spec.sha256 === null) {
        throw new Error(
          `Cannot emit: source "${spec.dataset}" is unpinned. Run fetch --write-pins and commit ` +
            "the checksum before building.",
        );
      }
      return {
        dataset: spec.dataset,
        name: spec.name,
        license: spec.license,
        upstreamVersion: spec.upstreamVersion,
        url: spec.url,
        sha256: spec.sha256,
      };
    })
    .sort((a, b) => (a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : 0));

  const polities: PolitiesArtifact = {
    schemaVersion: SCHEMA_VERSION,
    polities: input.polities,
  };
  const versions: VersionsArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "full",
    coordScale: COORD_SCALE.full,
    rows: input.versions,
    geometry: input.geometry,
  };
  const landCoarse: LandArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "coarse",
    coordScale: COORD_SCALE.coarse,
    polygons: input.land.coarse,
  };
  const landMid: LandArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "mid",
    coordScale: COORD_SCALE.mid,
    polygons: input.land.mid,
  };

  writeArtifact(join(input.outDir, "polities.json"), polities);
  writeArtifact(join(input.outDir, "versions.2.json"), versions);
  writeArtifact(join(input.outDir, "land.0.json"), landCoarse);
  writeArtifact(join(input.outDir, "land.1.json"), landMid);

  // Sorted so the manifest is stable regardless of write order.
  const files = ["land.0.json", "land.1.json", "polities.json", "versions.2.json"];
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    projection: PROJECTION,
    sources,
    artifacts: files.map((file) => measure(input.outDir, file)),
  };
  writeArtifact(join(input.outDir, "manifest.json"), manifest);
  return manifest;
}
