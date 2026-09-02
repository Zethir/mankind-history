// Bounding boxes as [minLon, minLat, maxLon, maxLat].
// None of these cross the antimeridian, which avoids the single most annoying
// bug in geo rendering. Keep it that way if you add more.

export const REGIONS = {
  mediterranean: {
    label: 'Mediterranean',
    bbox: [-10, 25, 45, 50], // Iberia to Mesopotamia, Sahara to the Danube
  },
  // Control slice. Same era, expected to be far sparser in Cliopatria.
  // The histogram will tell you which of these two is actually emptier.
  subsaharan: {
    label: 'Sub-Saharan Africa',
    bbox: [-18, -35, 52, 15],
  },
  seasia: {
    label: 'Southeast Asia',
    bbox: [92, -11, 141, 29],
  },
  world: {
    label: 'World',
    bbox: [-180, -90, 180, 90],
  },
};

export const ERAS = {
  classical: { label: 'Classical', from: -200, to: 500 },
  mongol: { label: 'Mongol', from: 1200, to: 1400 },
  earlymodern: { label: 'Early modern', from: 1500, to: 1900 },
  all: { label: 'All', from: -3400, to: 2024 },
};

export function resolveRegion(name) {
  const r = REGIONS[name];
  if (!r) {
    throw new Error(
      `Unknown region "${name}". Known: ${Object.keys(REGIONS).join(', ')}`
    );
  }
  return r;
}

export function resolveEra(name) {
  const e = ERAS[name];
  if (!e) {
    throw new Error(
      `Unknown era "${name}". Known: ${Object.keys(ERAS).join(', ')}`
    );
  }
  return e;
}
