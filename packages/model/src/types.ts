/** A political entity, stable across upstream re-releases. See decision 0007. */
export interface Polity {
  id: string;
  name: string;
  /**
   * Lowercased, diacritic-stripped slug. Not an identity key -- decision 0011
   * keys `id` on the raw `name` -- and not unique either (34 normalised names
   * collide across the full polity set). Stored for the deferred drift
   * report only.
   */
  normalizedName: string;
  /** Reference identifiers for future enrichment joins, not outbound links. */
  wikidata: string | null;
  wikipedia: string | null;
  seshat: string | null;
}

export interface SourceRef {
  dataset: "cliopatria";
  /** The upstream release this row came from. */
  version: string;
}

/** One dated territorial assertion about a polity. */
export interface Version {
  /** `${polityId}@${fromYear}`. Unique -- enforced by an acceptance criterion. */
  id: string;
  polityId: string;
  /**
   * Polity id of the aggregate this version belonged to, or null. From
   * Cliopatria's `MemberOf` -- the source's own stated imperial/dynastic
   * relationship (e.g. French Africa's `MemberOf` names the French Third
   * Republic), resolved through the same identity strategy as `polityId`
   * (decision 0011) so a later rename does not dangle. See decision 0017.
   */
  memberOf: string | null;
  /** Integer, negative for BCE. */
  fromYear: number;
  toYear: number;
  /** Square kilometres, from Cliopatria's equal-area computed Area. */
  area: number;
  /** Derived at build time. Null on first appearance. */
  prevId: string | null;
  delta: number | null;
  gap: number | null;
  /** Always null in Phase 1 -- no licensed source. See decision 0005. */
  confidence: number | null;
  source: SourceRef;
}

/** A ring as flat scaled-integer projected coordinates: [x0,y0,x1,y1,...]. */
export type Ring = number[];
/** Outer ring first, holes after. */
export type Polygon = Ring[];

export interface VersionGeometry {
  polygons: Polygon[];
  /** Scaled-integer projected [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  /** Scaled-integer projected pole of inaccessibility, for label placement. */
  anchor: [number, number];
}

export type LevelName = "coarse" | "mid" | "full";

export interface PolitiesArtifact {
  schemaVersion: number;
  polities: Polity[];
}

export interface VersionsArtifact {
  schemaVersion: number;
  level: LevelName;
  coordScale: number;
  rows: Version[];
  /** Keyed by version id. */
  geometry: Record<string, VersionGeometry>;
}

export interface LandArtifact {
  schemaVersion: number;
  level: LevelName;
  coordScale: number;
  polygons: Polygon[];
}

export interface ManifestSource {
  dataset: string;
  name: string;
  license: string;
  upstreamVersion: string;
  url: string;
  sha256: string;
}

export interface ManifestArtifact {
  file: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
}

/** Records provenance only. Deliberately carries no wall-clock time. */
export interface Manifest {
  schemaVersion: number;
  projection: "equal-earth";
  sources: ManifestSource[];
  artifacts: ManifestArtifact[];
}

/**
 * Change-year index. Backs decision 0006's viewport-scoped nextVisibleChange:
 * given a year and a viewport, the next year in which anything visible starts
 * or ends.
 *
 * Buckets POLYGONS, not versions -- a scattered empire's overall bounding box
 * covers most of the world while its individual polygons do not. See
 * docs/decisions/0013-index-buckets-polygons.md.
 */
export interface ChangesArtifact {
  schemaVersion: number;
  /** `bounds` is in unscaled projected units, so the grid is level-independent. */
  grid: { cols: number; rows: number; bounds: [number, number, number, number] };
  /** Row-major, cols * rows entries. Each a sorted, deduplicated year list. */
  cells: number[][];
}
