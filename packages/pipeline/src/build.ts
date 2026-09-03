import { readFileSync } from "node:fs";
import type { VersionGeometry } from "@history/model";
import { COORD_SCALE } from "@history/model";
import { SOURCES, type SourceSpec, sourcePath } from "./sources";
import { cutPolygons } from "./stages/antimeridian";
import { emit } from "./stages/emit";
import { type AliasEntry, assignIdentity, type IdentityConflicts } from "./stages/identity";
import { deriveLineage, type OverlapWhitelistEntry } from "./stages/lineage";
import {
  type NormalisedRow,
  type NormaliseReport,
  normaliseCliopatria,
  normaliseLand,
} from "./stages/normalise";
import { projectLand, projectPolygons } from "./stages/project";

export interface BuildOptions {
  sourcesDir: string;
  outDir: string;
  aliases: AliasEntry[];
  overlaps: OverlapWhitelistEntry[];
}

export interface BuildReport {
  normalise: NormaliseReport;
  /** Land features dropped during normalisation, per level -- invisible until reported. */
  normaliseLand: { coarse: NormaliseReport; mid: NormaliseReport };
  polities: number;
  versions: number;
  overlaps: number;
  identityConflicts: IdentityConflicts;
  polygonsCut: number;
  /** Antimeridian cuts on the land layers, counted separately from version cuts. */
  landPolygonsCut: { coarse: number; mid: number };
  landPolygons: { coarse: number; mid: number };
}

function readCollection(path: string): unknown[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { features?: unknown };
  if (!Array.isArray(parsed.features)) {
    throw new Error(`${path} is not a GeoJSON FeatureCollection`);
  }
  return parsed.features;
}

export function loadAliases(path: string): AliasEntry[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { aliases: AliasEntry[] }).aliases;
}

export function loadOverlaps(path: string): OverlapWhitelistEntry[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { overlaps: OverlapWhitelistEntry[] }).overlaps;
}

/**
 * The Milestone 1 pipeline, in memory end to end. Fetch is deliberately not
 * called from here: it is a separate cached command, so iterating on the
 * transform never re-downloads.
 */
export function build(options: BuildOptions): BuildReport {
  const cliopatria = SOURCES.cliopatria as SourceSpec;
  const ne110 = SOURCES.naturalEarth110mLand as SourceSpec;
  const ne50 = SOURCES.naturalEarth50mLand as SourceSpec;

  const { rows, report } = normaliseCliopatria(
    readCollection(sourcePath(cliopatria, options.sourcesDir)),
  );
  const { polities, rowPolityIds, conflicts } = assignIdentity(rows, options.aliases);
  const { versions, overlaps, rowIndexById } = deriveLineage(
    rows,
    rowPolityIds,
    options.overlaps,
    cliopatria.upstreamVersion,
  );

  const geometry: Record<string, VersionGeometry> = {};
  let polygonsCut = 0;
  for (const version of versions) {
    const row = rows[rowIndexById[version.id] as number] as NormalisedRow;
    const cut = cutPolygons(row.polygons);
    polygonsCut += cut.cut;
    geometry[version.id] = projectPolygons(cut.polygons, COORD_SCALE.full);
  }

  const normalisedCoarseLand = normaliseLand(readCollection(sourcePath(ne110, options.sourcesDir)));
  const cutCoarseLand = cutPolygons(normalisedCoarseLand.polygons);
  const coarse = projectLand(cutCoarseLand.polygons, COORD_SCALE.coarse);

  const normalisedMidLand = normaliseLand(readCollection(sourcePath(ne50, options.sourcesDir)));
  const cutMidLand = cutPolygons(normalisedMidLand.polygons);
  const mid = projectLand(cutMidLand.polygons, COORD_SCALE.mid);

  emit({
    outDir: options.outDir,
    polities,
    versions,
    geometry,
    land: { coarse, mid },
    sources: [cliopatria, ne110, ne50],
  });

  return {
    normalise: report,
    normaliseLand: { coarse: normalisedCoarseLand.report, mid: normalisedMidLand.report },
    polities: polities.length,
    versions: versions.length,
    overlaps: overlaps.length,
    identityConflicts: conflicts,
    polygonsCut,
    landPolygonsCut: { coarse: cutCoarseLand.cut, mid: cutMidLand.cut },
    landPolygons: { coarse: coarse.length, mid: mid.length },
  };
}
