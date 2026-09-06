export type LonLat = [number, number];
export type LonLatRing = LonLat[];
/** Outer ring first, holes after. */
export type LonLatPolygon = LonLatRing[];

export interface NormalisedRow {
  name: string;
  wikidata: string | null;
  wikipedia: string | null;
  seshat: string | null;
  fromYear: number;
  toYear: number;
  area: number;
  polygons: LonLatPolygon[];
}

export interface NormaliseReport {
  kept: number;
  /** Almost entirely RELATION rows. Dropped per decision 0008. */
  droppedNonPolity: number;
  droppedYears: number;
  droppedGeometry: number;
  /**
   * Polygon groups discarded from a feature that survived. Distinct from
   * droppedGeometry, which counts features that lost ALL geometry. These two do
   * not sum to anything meaningful; they measure different units deliberately.
   */
  droppedParts: number;
  closedRings: number;
}

function emptyReport(): NormaliseReport {
  return {
    kept: 0,
    droppedNonPolity: 0,
    droppedYears: 0,
    droppedGeometry: 0,
    droppedParts: 0,
    closedRings: 0,
  };
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

/** Cliopatria years are integers, negative for BCE. Some rows carry them as strings. */
export function toYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toWikidata(value: unknown): string | null {
  const s = toText(value);
  if (s === null) return null;
  const match = /(Q\d+)\s*$/.exec(s);
  return match ? (match[1] as string) : null;
}

/**
 * One canonical form for the article title, whatever shape the source uses.
 * This is a reference identifier for future enrichment joins, not an outbound
 * link - see docs/phase-1-design.md D13.
 */
export function toWikipedia(value: unknown): string | null {
  const s = toText(value);
  if (s === null) return null;
  const last = s.includes("/") ? (s.split("/").pop() as string) : s;
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Malformed percent-encoding: keep the raw segment rather than dropping the row.
  }
  const title = decoded.trim().replace(/\s+/g, "_");
  return title === "" ? null : title;
}

function ringOf(raw: unknown, report: NormaliseReport): LonLatRing | null {
  if (!Array.isArray(raw)) return null;
  const ring: LonLatRing = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  if (ring.length < 4) return null;
  const first = ring[0] as LonLat;
  const last = ring[ring.length - 1] as LonLat;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    // GeoJSON rings are closed by definition. Completing an unclosed one is
    // reading the format, not inventing a border.
    ring.push([first[0], first[1]]);
    report.closedRings++;
  }
  return ring;
}

function polygonsOf(geometry: unknown, report: NormaliseReport): LonLatPolygon[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return [];
  const groups =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? (g.coordinates as unknown[])
        : [];
  const out: LonLatPolygon[] = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) {
      report.droppedParts++;
      continue;
    }
    // An invalid outer ring discards the polygon; a hole is skipped on its own,
    // because promoting a hole to an outer ring would invent territory.
    const outer = ringOf(group[0], report);
    if (!outer) {
      report.droppedParts++;
      continue;
    }
    const polygon: LonLatPolygon = [outer];
    for (let i = 1; i < group.length; i++) {
      const hole = ringOf(group[i], report);
      if (hole) polygon.push(hole);
    }
    out.push(polygon);
  }
  return out;
}

export function normaliseCliopatria(features: unknown[]): {
  rows: NormalisedRow[];
  report: NormaliseReport;
} {
  const report = emptyReport();
  const rows: NormalisedRow[] = [];

  for (const feature of features) {
    const f = feature as { properties?: Record<string, unknown> | null; geometry?: unknown };
    const props = f.properties ?? {};

    if (String(props.Type ?? "").toUpperCase() !== "POLITY") {
      report.droppedNonPolity++;
      continue;
    }

    const fromYear = toYear(props.FromYear);
    const toYearValue = toYear(props.ToYear);
    if (fromYear === null || toYearValue === null || fromYear > toYearValue) {
      report.droppedYears++;
      continue;
    }

    const polygons = polygonsOf(f.geometry, report);
    if (polygons.length === 0) {
      report.droppedGeometry++;
      continue;
    }

    rows.push({
      name: toText(props.Name) ?? "unnamed",
      wikidata: toWikidata(props.Wikidata),
      wikipedia: toWikipedia(props.Wikipedia),
      seshat: toText(props.SeshatID),
      fromYear,
      toYear: toYearValue,
      area: Number.isFinite(Number(props.Area)) ? Number(props.Area) : 0,
      polygons,
    });
    report.kept++;
  }

  return { rows, report };
}

/** Natural Earth carries no properties worth keeping - decision 0003. */
export function normaliseLand(features: unknown[]): {
  polygons: LonLatPolygon[];
  report: NormaliseReport;
} {
  const report = emptyReport();
  const polygons: LonLatPolygon[] = [];
  for (const feature of features) {
    const f = feature as { geometry?: unknown };
    const found = polygonsOf(f.geometry, report);
    if (found.length === 0) {
      report.droppedGeometry++;
      continue;
    }
    report.kept++;
    polygons.push(...found);
  }
  return { polygons, report };
}
