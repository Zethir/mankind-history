# @history/model

Canonical types, the Equal Earth projection and its inverse, and the
artifact file contract. No runtime dependencies.

This is the only package the viewer may import from (decision 0009).
`packages/pipeline` depends on it; nothing here depends on `pipeline`.

## Canonical types (`types.ts`)

```ts
interface Polity {
  id: string;               // "name:<upstream Name>" - see ids.ts and decision 0011
  name: string;
  normalizedName: string;   // lowercase, diacritic-stripped slug - see normalize-name.ts
  wikidata: string | null;  // reference metadata, not the identity key
  wikipedia: string | null;
  seshat: string | null;
}

interface Version {
  id: string;                // `${polityId}@${fromYear}` - unique, enforced at build time
  polityId: string;
  fromYear: number;          // integer, negative for BCE
  toYear: number;
  area: number;               // km^2, from Cliopatria's equal-area computed Area
  prevId: string | null;      // previous version of the same polity - null on first appearance
  delta: number | null;       // area - prev.area - null on first appearance
  gap: number | null;         // years of silence since prev.toYear - null on first appearance
  confidence: number | null;  // always null in Phase 1 - no licensed source (decision 0005)
  source: { dataset: "cliopatria"; version: string };
}
```

`prevId`, `delta` and `gap` don't exist in the upstream data - Cliopatria
stores each version independently, with no link between one row and the row
that came before it for the same polity. The pipeline's lineage stage
derives all three at build time; without them nothing downstream (in
particular decision 0004's expansion flash) can tell a polity that grew from
one that shrank.

`confidence` stays in the schema, always `null`, because no CC-BY or
public-domain source for border precision currently exists - see decision
0005. Populating it is additive whenever that changes, not a schema break.

## The Equal Earth projection (`projection.ts`)

`equalEarth(lon, lat) -> [x, y]` is the forward transform (Savric, Patterson
& Jenny 2018), equal-area so territorial extent reads honestly (decision
0002). `equalEarthInverse(x, y) -> [lon, lat]` recovers the source
coordinate by Newton iteration - Equal Earth has no closed-form inverse -
and exists because the round-trip acceptance criterion (un-projecting any
stored coordinate must return the source lon/lat within 1e-6 degrees) needs
it. The viewer imports the same functions from this package rather than
reimplementing them.

## The artifact contract

Every `dist/` file is one of these shapes (`types.ts`), written by
`writeArtifact` and read by `readArtifact` (`artifact.ts`):

```
polities.json     { schemaVersion, polities: Polity[] }
versions.{n}.json { schemaVersion, level, coordScale, rows: Version[],
                     geometry: Record<versionId, VersionGeometry> }
land.{n}.json     { schemaVersion, level, coordScale, polygons: Polygon[] }
manifest.json     { schemaVersion, projection, sources: ManifestSource[],
                     artifacts: ManifestArtifact[] }
```

`versions.{n}.json` is self-contained on purpose: version rows and their
projected geometry together, because the viewer loads exactly one detail
level per zoom and wants a single fetch rather than joining two files at
render time.

`Polygon` is `Ring[]` (outer ring first, holes after), and a `Ring` is a flat
array of scaled-integer coordinates: `[x0, y0, x1, y1, ...]`. `bbox` is
`[minX, minY, maxX, maxY]`; `anchor` is a `[x, y]` label point (the polygon's
pole of inaccessibility), for future name placement.

## Coordinate scaling

Coordinates are stored as `Math.round(projected * scale)`, never raw floats.
Per-level scales live in `canon.ts` (`COORD_SCALE`). Two reasons:

- **Determinism.** An integer has one textual representation; a float has a
  formatting decision behind it. Storing integers makes byte-identical
  output true by construction rather than by careful float-rounding
  discipline (decision 0010).
- **Precision is then a chosen, checked number**, not an accident of
  whatever `JSON.stringify` does to a float. `full`'s scale (`1e9`) is set so
  that un-projecting a stored coordinate returns the source lon/lat within
  1e-6 degrees - measured, not assumed; see the comment in `canon.ts` and
  `tests/projection.test.ts` for the sweep that pins it.

`artifact.ts`'s writer throws on any non-finite number reaching an artifact,
so a NaN or Infinity anywhere in the geometry pipeline fails the build rather
than shipping silently.
