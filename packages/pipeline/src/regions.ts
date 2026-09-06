/**
 * Region and era presets for the playback-density histogram (see
 * stages/histogram.ts). The bounding boxes are restored verbatim from the
 * Phase 0 spike so results stay comparable to that baseline -- do not adjust
 * them. Bounding boxes are [minLon, minLat, maxLon, maxLat]; none crosses the
 * antimeridian, and any addition must keep that property.
 */
export const REGIONS = {
  mediterranean: { label: "Mediterranean", bbox: [-10, 25, 45, 50] },
  subsaharan: { label: "Sub-Saharan Africa", bbox: [-18, -35, 52, 15] },
  seasia: { label: "Southeast Asia", bbox: [92, -11, 141, 29] },
  world: { label: "World", bbox: [-180, -90, 180, 90] },
} as const satisfies Record<string, { label: string; bbox: [number, number, number, number] }>;

export const ERAS = {
  classical: { label: "Classical", from: -200, to: 500 },
  mongol: { label: "Mongol", from: 1200, to: 1400 },
  earlymodern: { label: "Early modern", from: 1500, to: 1900 },
  all: { label: "All", from: -3400, to: 2024 },
} as const satisfies Record<string, { label: string; from: number; to: number }>;

function isRegionName(name: string): name is keyof typeof REGIONS {
  return name in REGIONS;
}

function isEraName(name: string): name is keyof typeof ERAS {
  return name in ERAS;
}

export function resolveRegion(name: string): (typeof REGIONS)[keyof typeof REGIONS] {
  if (isRegionName(name)) return REGIONS[name];
  throw new Error(`Unknown region "${name}". Known regions: ${Object.keys(REGIONS).join(", ")}`);
}

export function resolveEra(name: string): (typeof ERAS)[keyof typeof ERAS] {
  if (isEraName(name)) return ERAS[name];
  throw new Error(`Unknown era "${name}". Known eras: ${Object.keys(ERAS).join(", ")}`);
}
