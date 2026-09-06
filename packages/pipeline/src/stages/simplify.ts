import type { Polygon, Ring } from "@history/model";
import mapshaper from "mapshaper";

// mapshaper is CommonJS and does not statically expose named exports under
// Node's real ESM/CJS interop (only Vite's bundler-based interop is lenient
// enough for that) -- see mapshaper.d.ts. Read applyCommands off the default
// export at runtime instead of importing it by name.
const { applyCommands } = mapshaper;

export interface SimplifyInput {
  id: string;
  polygons: Polygon[];
}

/** GeoJSON position array for one ring, from our flat scaled-integer form. */
function ringToCoords(ring: Ring): number[][] {
  const out: number[][] = new Array(ring.length / 2);
  for (let i = 0; i < ring.length; i += 2) {
    out[i / 2] = [ring[i] as number, ring[i + 1] as number];
  }
  return out;
}

function coordsToRing(coords: number[][]): Ring {
  const flat: Ring = new Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i] as number[];
    flat[i * 2] = Math.round(p[0] as number);
    flat[i * 2 + 1] = Math.round(p[1] as number);
  }
  return flat;
}

/**
 * Topology-preserving simplification via mapshaper.
 *
 * Every group goes through ONE mapshaper call so topology is shared: mapshaper
 * detects arcs common to neighbouring polygons and simplifies them identically,
 * which is what stops gaps opening between borders. Do not "optimise" this into
 * one call per group -- that discards the shared topology and is the specific
 * failure the no-new-gaps acceptance criterion exists to catch.
 *
 * Coordinates in and out are scaled integers at COORD_SCALE.full. mapshaper
 * treats them as planar, which is what we want: they are already projected, and
 * Equal Earth is equal-area, so an area threshold means the same real area
 * everywhere.
 *
 * `keep-shapes` stops small polities being removed entirely. A state vanishing
 * because it was small would be exactly the silent falsehood this project
 * forbids.
 */
export async function simplifyPolygonGroups(
  groups: SimplifyInput[],
  percent: number,
): Promise<Map<string, Polygon[]>> {
  const features = groups.map((g) => ({
    type: "Feature" as const,
    properties: { id: g.id },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: g.polygons.map((polygon) => polygon.map(ringToCoords)),
    },
  }));

  const input = JSON.stringify({ type: "FeatureCollection", features });
  const command = `-i in.json -simplify visvalingam weighted ${percent}% keep-shapes -o out.json`;
  const result = await applyCommands(command, { "in.json": input });
  const raw = result["out.json"];
  if (!raw) throw new Error("mapshaper produced no output");

  const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as {
    features: Array<{
      properties: { id: string };
      geometry: { type: string; coordinates: unknown } | null;
    }>;
  };

  const out = new Map<string, Polygon[]>();
  for (const feature of parsed.features) {
    const g = feature.geometry;
    if (!g) continue;
    const groupsOut =
      g.type === "Polygon"
        ? [g.coordinates as number[][][]]
        : g.type === "MultiPolygon"
          ? (g.coordinates as number[][][][])
          : [];
    out.set(
      feature.properties.id,
      groupsOut.map((rings) => rings.map(coordsToRing)),
    );
  }
  return out;
}
