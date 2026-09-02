# Phase 1 — The data spine

Turn upstream datasets into versioned, validated, render-ready build artifacts.

This is the phase where "ready for deep coverage" is won or lost. Going from a
coarse global map to a high-resolution regional one should later be a matter of
inserting more versions with tighter intervals, not a migration.

**The Phase 0 spike in `scripts/` and `src/` is not the starting point.** It has
no schema, no validation and no tests. Read it for the projection maths and the
alpha curves, then leave it behind.

## Output

Phase 1 produces a directory of static build artifacts and nothing else. Phase 2
consumes only these. That boundary is deliberate: if the viewer can see nothing
but build output, the pipeline can be rewritten without touching the renderer.

```
dist/
  manifest.json         sources, upstream versions, licences, checksums, index
  polities.json         id -> name, wikidata, wikipedia, seshat
  versions.0.json       version rows, projected geometry, coarsest detail
  versions.1.json       mid detail
  versions.2.json       full detail
  changes.json          change-year index, spatially bucketed
  land.0.json           Natural Earth 110m, projected
  land.1.json           Natural Earth 50m, projected
```

Plus the importer source and a test suite implementing the acceptance criteria
below.

## Stack

The build pipeline is Node reading JSON and writing JSON, so most of this is
low-stakes and reversible. It is recorded because Phase 1 is where the real
repository starts.

- **TypeScript.** The point is not ceremony. The canonical model below becomes
  actual types, so a `Version` missing `gap` fails at compile time rather than in
  a validation script somebody forgets to run. For a phase whose entire subject
  is a schema, this is the highest-leverage tool available.
- **Node 22, ESM, pnpm workspaces.** See 0009. Types live in `packages/model`
  so the viewer can read artifacts without importing pipeline code.
- **Vitest** for the acceptance criteria.
- **Biome** for lint and format. One tool, one config.
- **mapshaper** as a pipeline dependency, for topology-preserving simplification.

**No database.** At ~14,000 records a static build pipeline is genuinely
sufficient, and adding Postgres buys operational overhead in exchange for
nothing. PostGIS becomes the right answer in Phase 4, when there is authoring,
concurrent edits and more than one contributor. The canonical model is designed
so that is an addition rather than a rewrite.

**JSON output for v1.** Typed arrays or protobuf are the escape hatch if the
global artifact exceeds the 8 MB budget. Do not pre-optimise this.

## Canonical model

Entity identity plus validity intervals. Not snapshots.

```
Polity
  id            stable, survives upstream re-releases
  name
  wikidata      nullable
  wikipedia     nullable
  seshat        nullable

Version
  id
  polity_id
  from_year     integer, negative for BCE
  to_year       integer
  geometry      projected, multiple simplification levels
  area          km²
  prev_id       previous version of the same polity, null on first appearance
  delta         signed area change vs previous, null on first appearance
  gap           years of silence since prev.to_year, null on first appearance
  confidence    border reliability — see open question below
  source        which dataset and which upstream version this came from
```

`prev_id`, `delta` and `gap` are **derived at build time**. Cliopatria stores
versions independently with no link between them, so without this the renderer
cannot tell growth from shrinkage. Decision 0004 depends entirely on these.

## Pipeline stages

1. **Fetch and pin.** Record upstream version and checksum for every source.
2. **Normalise.** Map to the canonical schema. Coerce year fields (some arrive
   as strings). Filter to POLITY.
3. **Validate.** See acceptance criteria. Fail the build, do not warn.
4. **Derive lineage.** Group by polity, sort by `from_year`, compute `prev_id`,
   `delta`, `gap`.
5. **Simplify.** Topology-preserving, at 3 levels. Plain per-polygon
   simplification cracks shared borders into hairline gaps that look like
   rendering bugs.
6. **Project.** Equal Earth, at build time.
7. **Index.** Change years, bucketed spatially, supporting "next change after
   year T within bbox B" (required by decision 0006).
8. **Emit.** Artifacts plus a manifest recording sources, versions, licences.

## Acceptance criteria

Runnable checks. "The importer works" is not a criterion.

**Lineage**
- Every version has non-null `prev_id`, `delta` and `gap`, except first
  appearances, which have all three null.
- No polity has two versions with the same `from_year`.
- Overlapping versions of one polity: count is reported and must be zero, or
  the overlap must be explicitly whitelisted with a reason.
- `delta` equals `area − prev.area` for every non-first version.

**Geometry**
- Every ring is closed, has ≥4 points, and contains no NaN or infinite values.
- Un-projecting any coordinate returns the source lon/lat within 1e-6.
- After simplification, no pair of previously-adjacent polygons has gained a gap
  wider than one screen pixel at the coarsest zoom that level serves.
- No polygon crosses the antimeridian in projected space.

**Index**
- For 1,000 random (year, bbox) pairs, the next-change lookup matches a
  brute-force scan.

**Build**
- Deterministic: identical inputs produce byte-identical outputs.
- Manifest names every source with its upstream version and licence.
- Coarsest global artifact is under 8 MB gzipped.

## Open questions

- **`confidence` has no source.** The obvious one, `historical-basemaps`
  `BORDERPRECISION`, is available but carries a GPL-3.0 consequence and a fuzzy
  name join (0005, 0008). Decision: leave the field in the schema, unpopulated,
  and carry an honest line in the UI instead. Revisit when fuzzy-border
  rendering is actually being built. Do not invent a value and present it as
  data.
- **`RELATION` rows.** Currently dropped. They encode composite and membership
  structure, which is real information the map could use — vassals, personal
  unions, tributary status. Rendering them is a Phase 3 design question.
- **Polity identity across upstream releases.** Resolved in principle, see
  `docs/decisions/0007-polity-identity.md`. Remaining work is implementing the
  drift report and deciding where `aliases.json` lives.
