# Architecture

The narrative a new contributor should read first. `docs/decisions/` has the
detail and the trade-offs behind each call made here; this document is the
map of how the pieces fit together.

## The shape of the thing

A build pipeline that produces static artifacts, and a viewer that consumes
only those artifacts. Nothing else talks to the pipeline, and the pipeline
knows nothing about rendering.

The reason is the boundary itself: if the viewer can see nothing but build
output, the pipeline can be rewritten - a new upstream source, a different
identity strategy, a new simplification algorithm - without touching the
renderer. `docs/phase-1-importer.md` calls this Phase 1's job; Phase 2 (the
viewer) only starts once it holds.

## The package boundary

```
packages/
  model/      canonical types + Equal Earth projection + artifact contract
  pipeline/   the build. Depends on model.
  viewer/     Phase 2. Will depend on model (types) and dist/ (data),
              never on pipeline.
```

`model` exists as its own package specifically to make this boundary
self-enforcing (decision 0009). The viewer needs types to read build
artifacts, but it must never reach into the pipeline to get them - so the
types live somewhere both can import without either importing the other.

Honestly: this is enforced by discipline and code review, not by tooling.
Nx's `@nx/enforce-module-boundaries` would make it mechanical, but at three
packages the config and migration cost was judged not worth it yet (0009).
If the viewer ever imports pipeline code and nobody notices in review, that
is the signal to revisit.

## The canonical model

Entity identity plus validity intervals, not snapshots: a `Polity` is a
stable identity across time, and each `Version` asserts "this polity held
this shape from `fromYear` to `toYear`" - a claim the source itself makes and
stands behind.

The alternative, used by other datasets in this space, is one GeoJSON file
per sampled year. Decision 0008 is why that lost: a snapshot for 1492 and a
snapshot for 1530 say nothing about 1500, and rendering 1500 anyway means
inferring that 1492's borders persisted - an inference this project would be
making, not the source. That is the same failure as morphing geometry (0001),
applied to the time axis instead of the space axis, and this project's one
non-negotiable rules it out.

Two consequences of that choice that a new contributor will otherwise trip
over:

**Identity keys on the upstream `Name`, not the Wikidata id.** Decision 0007
originally keyed a polity on its Wikidata id, falling back to a normalised
name. Running that against the real 13,380-row Cliopatria release showed it
to be wrong: Wikidata ids are reused across genuinely distinct polities -
`Q7462` covers Song, Northern Song and Southern Song - and a small number of
entities carry the id on some rows and not others. Keying on the id would
have spliced Northern Song and Southern Song into one continuous lineage
chain across their dynastic boundary, with `delta` and `gap` computed
straight through it and fed into the expansion flash as a fabricated smooth
transition. Decision 0011 amends 0007: identity keys on the raw, unnormalised
upstream `Name`. Wikidata is still stored on every polity, but as metadata,
matching what Cliopatria's own documentation says it is for.

**`prevId`, `delta` and `gap` are derived at build time.** Cliopatria stores
each version independently - there is no field linking one row to the row
that came before it for the same polity. Without deriving these three,
nothing downstream can tell a polity that grew from one that shrank, and
decision 0004's expansion flash (which brightens growth and suppresses itself
across sampling gaps longer than 50 years, so it never dramatises what a gap
in the atlas coverage doesn't support) has nothing to read. The lineage stage
computes all three by grouping rows per polity, sorting by year, and linking
each version to its predecessor.

## The stages

`pipeline build` runs these in-process, in order:

1. **Fetch** (`packages/pipeline/src/fetch/download.ts`) - downloads each
   pinned source, verifies its SHA-256, and unpacks it. Nothing is written
   before the checksum matches; a pipeline that proceeds on unverified input
   cannot make the determinism guarantee. Run separately from `build` via
   `pnpm fetch:sources`, so iterating on the transform never re-downloads.
2. **Normalise** (`stages/normalise.ts`) - parses the raw GeoJSON, keeps only
   `Type === "POLITY"` rows, coerces year fields (some upstream rows carry
   them as strings) and the `Wikipedia` field to one canonical form, and
   closes any ring GeoJSON left open. Every drop is counted and reported, not
   silently discarded.
3. **Resolve identity** (`stages/identity.ts`) - groups rows into polities by
   the `Name`-keyed strategy above, applying `aliases.json` first for the
   handful of known upstream renames.
4. **Derive lineage** (`stages/lineage.ts`) - sorts each polity's versions by
   year and computes `prevId`, `delta` and `gap`. Fails the build (not a
   warning - see Determinism, and `docs/standards.md`) on a duplicate
   `(polity, fromYear)` pair, or on an overlap not listed in `overlaps.json`
   with a reason.
5. **Project** (`stages/project.ts`, `stages/antimeridian.ts`) - Equal Earth
   forward projection on every ring, after cutting any ring that wraps the
   antimeridian (decision 0012 - see the note below). Coordinates are rounded
   to scaled integers at build time, so no float-formatting decision reaches
   the output.
6. **Simplify** (`stages/simplify.ts`) - topology-preserving simplification via
   mapshaper (Visvalingam weighted, `keep-shapes`), producing `versions.1.json`
   (mid, 60% vertex retention) and `versions.0.json` (coarse, 30%) for the
   viewer's regional and global zoom levels. Every group of polygons goes
   through mapshaper in **one call**, not one call per polity: mapshaper
   detects the arcs two neighbouring polities' borders actually share and
   simplifies each shared arc identically, which is what stops a border
   opening a gap against itself. This works on Cliopatria specifically because
   the dataset shares vertex positions between polities to begin with -
   3,422,830 total vertices reduce to 104,966 distinct positions, and 74.6% of
   those distinct positions are used by more than one polity. Simplify
   anything with less real sharing and the same one-call approach would have
   little topology to preserve.
7. **Index** (`stages/change-index.ts`) - a spatially-bucketed change-year
   index, `changes.json`, backing decision 0006's viewport-scoped "when does
   this view next change". Bucketed by polygon, not by version; decision 0013
   is why.
8. **Emit** (`stages/emit.ts`) - writes `polities.json`, `versions.0/1/2.json`,
   `land.0.json` and `land.1.json` through the one deterministic writer, then
   `manifest.json`, which hashes and sizes everything else and records every
   source's name, licence, upstream version and checksum.

**On the no-new-gaps criterion.** `docs/phase-1-importer.md` states the
acceptance criterion as a one-pixel gap bound: no border simplification may
open a gap wider than one screen pixel between two polygons that shared an
edge before simplification. What ships is narrower than that wording. A direct
pixel-displacement measurement was attempted in six distinct formulations, and
every one measured polygon *removal* rather than border *displacement* - a
sub-pixel polygon that simplification drops entirely leaves no adjacent pair
left to have a gap between, and cannot be told apart from a polygon that
survived without a stable per-ring identity carried through mapshaper. What is
asserted instead, in `packages/pipeline/tests/acceptance.test.ts`'s
"simplification" suite, is that shared borders survive identically: 99.35% of
shared edges on the fixture and 99.72-99.79% on the real dataset keep exactly
the same simplified points on both sides. Displacement is computed and printed
for the cases that don't, but not asserted against a pixel bound. The
regression the pixel criterion was meant to catch is instead gated by the
noisy-shared-boundary test in `packages/pipeline/tests/simplify.test.ts`,
verified to fail when simplification is rewritten to one mapshaper call per
group instead of one call for the whole group.

**A note on temporal coverage.** `docs/data-sources.md` already warns that the
classical Mediterranean is Cliopatria's best-covered slice and that treating it
as representative will mislead you. The change index quantifies that warning:
of 937 distinct change years worldwide, the single densest grid cell sits over
Europe and alone holds 855 of them - 91% - and the Mediterranean region's cell
range captures effectively all 937. This has a direct consequence for decision
0006's viewport-scoped playback acceleration: it will barely engage while the
viewport sits over Europe, because there is almost always something changing
nearby, and it will dominate everywhere else, because there mostly isn't.

**A note on the antimeridian stage.** No polygon in the pinned Cliopatria
release actually crosses 180 degrees longitude - the maximum absolute
longitude in the whole dataset is exactly 180, and a full build of the real
data cuts zero polygons. The cutting code is real and load-bearing for
whatever upstream ships next, but on this release it is exercised only by
the ten synthetic-ring tests in `packages/pipeline/tests/antimeridian.test.ts`,
not by anything in the shipped artifacts. `fixtures/README.md` explains why
the fixture carries no antimeridian-adjacent slice either.

## Determinism

"Identical inputs produce byte-identical outputs" is an acceptance criterion,
but taken absolutely it isn't achievable: the projection maths calls
`Math.sin` and `Math.asin`, whose results are engine-dependent, and
mapshaper's simplification has its own floating-point behaviour tied to its
version. Decision 0010 scopes the guarantee to a **pinned toolchain** - the
Node version in `.nvmrc` and the exact dependency versions in the lockfile -
and mapshaper is now inside that scope along with everything else: its
determinism was verified byte-identical across independent build processes
run against the real dataset, not assumed from its own documentation.
Bumping either the toolchain or the mapshaper version is a deliberate act
that ends with re-blessing the golden fixture artifacts and reviewing the
diff.

Three things make this real rather than aspirational: inputs are
checksum-pinned so "identical inputs" is verified rather than assumed; every
artifact goes through the one writer in `packages/model/src/artifact.ts`,
with sorted keys, LF endings and a trailing newline; and coordinates are
scaled integers, so there is no float-formatting decision left to make at
write time. There is no wall-clock timestamp anywhere in `dist/` - provenance
is upstream versions and checksums, properties of the inputs, not of the run.

## Why no database

At roughly 14,000 source records, a static build pipeline is genuinely
sufficient. Reading `dist/` is a handful of `fetch()` calls the viewer
already needs to make regardless; a database would buy operational overhead
- something to run, something to migrate, something to keep in sync with a
build - in exchange for nothing this project currently needs.

PostGIS becomes the right answer in Phase 4, when there is authoring and more
than one contributor writing to the data concurrently. The canonical model
(entity identity, validity intervals, derived lineage) is designed so that is
an addition when it happens, not a rewrite: the same `Polity` / `Version`
shape that comes out of the build pipeline today is what a database schema
would hold later.
