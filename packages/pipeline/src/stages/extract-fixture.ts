/**
 * Carve a committed test slice out of the fetched dataset.
 *
 * Selection is by vertex and whole-feature: a feature is kept if any vertex
 * falls inside the box, and its geometry is then taken entire. Clipping to
 * the box is deliberately not done, because a clipped edge is a border the
 * source never asserted. Whole-feature selection is therefore what forces
 * the box to be small -- one vertex inside it pulls in a polity's entire
 * multi-century extent.
 *
 * There is deliberately no antimeridian selector. No row in the pinned
 * Cliopatria release wraps the antimeridian at all -- the maximum absolute
 * longitude in the dataset is exactly 180, and a full pipeline run cuts
 * zero polygons -- so a selector built to capture wrapping geometry would
 * have nothing real to capture; it was measured to cost 10+ MB of Russia's
 * un-clipped multi-century outline (the one polity that reaches exactly 180)
 * for zero exercise of the cutting path. That path is covered on its own
 * terms by the ten synthetic-ring tests in
 * `packages/pipeline/tests/antimeridian.test.ts`, which is the honest place
 * for it. If a future upstream release introduces real wrapping geometry,
 * reinstate a selector here: add an `ANTIMERIDIAN_LON` threshold and OR a
 * `Math.abs(lon) >= ANTIMERIDIAN_LON` check into the predicate below (see
 * git history on this file for the prior implementation), then re-run
 * `pnpm extract-fixture` and `pnpm fixture:bless` and check the resulting
 * size before committing.
 */

/**
 * The city of Rome and its immediate surroundings. Two wider boxes were
 * tried first and rejected on size: the full central-Mediterranean box
 * `[5, 34, 30, 47]` produced a 76 MB fixture, and "Italy alone"
 * `[8, 36, 19, 47]` still produced 69 MB, because selection is by vertex on
 * un-clipped whole features (see the module doc) -- any box touching the
 * Italian peninsula also has a vertex inside several continent-spanning
 * empires (the Spanish Empire, the Holy Roman Empire, the Ottoman Empire),
 * each a several-thousand-vertex multipolygon repeated across dozens of
 * yearly rows. This tight box still lands on real dense lineage -- Roman
 * Kingdom, Roman Republic, (Western) Roman Empire, Ostrogothic Kingdom,
 * Papal States, Kingdom of Italy, Nazi-occupied Italy, Republic of Italy --
 * plus several RELATION rows and mostly multipolygon geometry, at a
 * fraction of the size.
 */
export const FIXTURE_BBOX: [number, number, number, number] = [12.2, 41.6, 12.9, 42.1];

function visitVertices(geometry: unknown, visit: (lon: number, lat: number) => boolean): boolean {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return false;
  const groups =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? (g.coordinates as unknown[])
        : [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const ring of group) {
      if (!Array.isArray(ring)) continue;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        if (Number.isFinite(lon) && Number.isFinite(lat) && visit(lon, lat)) return true;
      }
    }
  }
  return false;
}

export function selectFeatures(features: unknown[]): unknown[] {
  const [minLon, minLat, maxLon, maxLat] = FIXTURE_BBOX;
  return features.filter((feature) =>
    visitVertices(
      (feature as { geometry?: unknown }).geometry,
      (lon, lat) => lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat,
    ),
  );
}
