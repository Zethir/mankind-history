import { readFileSync } from "node:fs";
import type { VersionGeometry } from "@history/model";
import { COORD_SCALE, SIMPLIFY_PERCENT } from "@history/model";
import { SOURCES, type SourceSpec, sourcePath } from "./sources";
import { cutPolygons } from "./stages/antimeridian";
import { buildChangeIndex } from "./stages/change-index";
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
import { simplifyPolygonGroups } from "./stages/simplify";

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
  /** Vertex count and the SIMPLIFY_PERCENT used, per coarser level. */
  levels: Record<"coarse" | "mid", { vertices: number; percent: number }>;
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
 * The pipeline, in memory end to end. Fetch is deliberately not called from
 * here: it is a separate cached command, so iterating on the transform never
 * re-downloads.
 *
 * Async because simplifying the two coarser levels goes through mapshaper's
 * async API (see stages/simplify.ts).
 */
export async function build(options: BuildOptions): Promise<BuildReport> {
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

  // Simplify once per coarser level, from full detail rather than cascading, so
  // error does not compound. All versions go through one mapshaper call per
  // level -- see stages/simplify.ts for why that must not be split up.
  const groups = versions.map((v) => ({
    id: v.id,
    polygons: (geometry[v.id] as VersionGeometry).polygons,
  }));

  const levels: Record<"coarse" | "mid", Record<string, VersionGeometry>> = {
    coarse: {},
    mid: {},
  };
  const levelStats: BuildReport["levels"] = {
    coarse: { vertices: 0, percent: SIMPLIFY_PERCENT.coarse },
    mid: { vertices: 0, percent: SIMPLIFY_PERCENT.mid },
  };

  for (const level of ["coarse", "mid"] as const) {
    const simplified = await simplifyPolygonGroups(groups, SIMPLIFY_PERCENT[level]);
    const scale = COORD_SCALE[level];
    for (const version of versions) {
      const source = geometry[version.id] as VersionGeometry;
      const polygons = (simplified.get(version.id) ?? source.polygons).map((polygon) =>
        polygon.map((ring) => {
          const out: number[] = new Array(ring.length);
          for (let i = 0; i < ring.length; i++) {
            out[i] = Math.round(((ring[i] as number) / COORD_SCALE.full) * scale);
          }
          return out;
        }),
      );
      for (const polygon of polygons)
        for (const ring of polygon) levelStats[level].vertices += ring.length / 2;
      const rescale = (v: number) => Math.round((v / COORD_SCALE.full) * scale);
      levels[level][version.id] = {
        polygons,
        bbox: source.bbox.map(rescale) as [number, number, number, number],
        anchor: source.anchor.map(rescale) as [number, number],
      };
    }
  }

  const changes = buildChangeIndex(versions, geometry, COORD_SCALE.full);

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
    geometry: { coarse: levels.coarse, mid: levels.mid, full: geometry },
    changes,
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
    levels: levelStats,
  };
}
