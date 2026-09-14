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
  viewer/     the viewer. Depends on model (types) and dist/ (data),
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

## The engine/renderer split, and why the engine is DOM-free

Inside `viewer/`, `src/engine/` computes what year it is, which versions are
active, and at what opacity and flash - and never touches `HTMLElement`,
`document`, `window`, or the canvas. `src/render/` reads that output and
turns it into `Path2D` calls; `src/ui/` is the chrome (play/pause, scrub,
speed) around both. The engine can be driven from a test with a fake clock
tick and no browser at all.

The reason is not general hygiene. Three of this project's decisions -
0001 (crossfade, never geometry morphing), 0004 (the expansion flash
suppresses itself across sampling gaps it cannot attribute), and 0006
(playback speed adapts to change density) - are invariants the project holds
itself to, not incidental behaviour. A DOM-dependent engine can only have
those invariants checked by eye, in a running browser, by someone watching
for a frame that morphed, flashed on a gap, or paced wrong. A DOM-free engine
makes each one a named unit test against plain numbers instead:
`tests/fade.test.ts`, `tests/flash.test.ts` and `tests/clock.test.ts` assert
them directly. Acceptance criterion 19 is the DOM-free property itself:
because the engine touches no DOM, `tests/engine.test.ts` can snapshot its
whole behaviour - active set, alpha, flash - across a swept set of years with
no canvas or browser involved, and commit the snapshots so a future change
that alters playback shows up as a diff there rather than as something
someone had to notice on screen.

Two figures from this split, both measured on the real dataset rather than
guessed:

- **Worst-case frame cost.** The coarse level's two maxima fall in different
  years: 2014 has the most active versions (195, 18,537 vertices), 1919 has
  the most on-screen vertices (19,729, from 90 versions) - under 20,000
  vertices even at the single densest moment in 5,424 years of coverage. That
  measurement is why
  `MapRenderer` does no render caching beyond memoizing each version's
  `Path2D` for its lifetime: see decision 0015 for the full distribution
  (median, p95, worst) and the reasoning.
- **`viewport.scale`.** `fitWorld` in `src/render/transform.ts` computes the
  real screen-pixels-per-projected-unit figure at whatever size the canvas
  actually is. At a 1400x900 viewport it measures 258.6242 px per projected
  unit - the real, measured figure `packages/model/src/canon.ts` now records
  as `DISPLACEMENT_REFERENCE_SCALE`, replacing the provisional `PX_PER_UNIT`
  guesses made before any viewport existed. See "Zoom, progressive detail,
  and viewport-scoped playback" below and decision 0020.

Neither figure says anything about whether the playback feel or the palette
hold up at that density. The original 16-hue palette was watched and reported
broken; a geographic-hue replacement was tried and measured to be worse, not
better (decision 0016); a two-tier palette (sprawling empires graph-coloured
at higher saturation, everyone else hash-assigned at lower saturation)
replaced both, and was itself superseded by a 1970s family palette (decision
0018): 10 hue families x 4 lightness shades, one shared 40-colour space
instead of two saturation tiers. Colour is assigned by graph colouring
against the union of two kinds of adjacency: co-visibility (two candidates
coexist in time, widened by the renderer's own crossfade margin) and spatial
proximity (two drawn territories' bounding boxes overlap on screen in some
year they are both live) -- the latter is what actually closes most real
on-screen collisions, since most of them are between two ordinary compact
neighbours, not empires. A member of an empire does not shade its own hue
from the aggregate's family; it takes the aggregate's exact colour, resolved
transitively to the root aggregate, so the whole empire reads as one merged
fill under a boundary outline (decision 0019, which also records why an
earlier attempt at shading members from one hue -- declination -- was tried
and rejected as unreadable once two empires sit next to each other). None of
these palettes has been judged by a human watching the map run against the
real dataset, and that judgement is Milestone 1's exit condition, not
something this document can assert on their behalf.

## Zoom, progressive detail, and viewport-scoped playback (Milestone 2)

Milestone 1 shipped a map with exactly one viewport: the whole world, fit to
the canvas. Milestone 2 adds zoom and pan (`src/render/transform.ts`'s
`Viewport`, a centre in projected units plus a screen-pixels-per-projected-unit
`scale`), and everything downstream of that had to stop assuming the viewport
is the world.

**Levels are a load order, not a zoom mapping.** `DetailLevel`
(`src/render/level.ts`) names three artifacts -- coarse, mid, full -- but
nothing selects between them by zoom scale. Coarse paints on first load; mid
is prefetched at low priority once first paint completes and silently
replaces coarse's geometry when it arrives; full is fetched only once the
user has zoomed at least once, on the theory that a zoom is evidence someone
is exploring rather than glancing. Detail only ever improves and never
downgrades. This shape exists because Milestone 2 twice tried to build a
zoom-based switching threshold and measured, both times, that this dataset
does not support one: border displacement (Task 1) turned out to be the same
seven world-space events at coarse and mid regardless of scale, and
retained-vertex spacing (Task 6) differs by at most 35% between any two
levels with identical maxima. Neither measurement produces a scale where one
level looks meaningfully worse than the next. See
`docs/decisions/0020-percentile-displacement.md` and
docs/phase-2-milestone-2-design.md, "Thresholds: what the measurement
actually showed", for the full arithmetic and the two measurements that
killed the idea.

**Land saturates at mid by construction, not by a lookup.** The pipeline
emits only `land.0` and `land.1` -- there is no `land.2` -- so the land
basemap has nowhere finer to go past mid regardless of how detailed the
political layer gets. Milestone 2 originally carried this as a runtime
function, `landLevelFor(level: DetailLevel): "coarse" | "mid"`, mapping the
political layer's level to the land level. It was deleted once its last
production caller went away: the land basemap now upgrades as soon as its own
`fetchLand` request resolves, independent of the versions level entirely (see
`src/main.ts`), so there was nothing left calling it. The invariant it used
to enforce at runtime -- land never requests a level the pipeline does not
emit -- is now carried by `fetchLand`'s own parameter type,
`level: "coarse" | "mid"` (`src/data/artifacts.ts`), which cannot even be
asked to hold a third value. A dead function that still typechecks is a worse
record of an invariant than a type signature that makes violating it
impossible to write, so the type is the record now, not a comment pointing at
retired code.

**A failed fetch does not retry in a loop.** If a level's fetch fails, the
viewer stays on whatever level it already has, logs it, and does not
re-attempt on every subsequent zoom event -- a multi-megabyte request retried
on every wheel tick would look like a hang.

**Playback stays viewport-scoped, and the asymmetry is deliberate.**
`ChangeYears` (`src/engine/change-years.ts`) answers "what changes next"
against `changes.json`'s spatial index rather than scanning every version row
-- Milestone 1 could scan rows because its one viewport was the world; once
the viewport is a sub-region, the index is the only structure that can answer
"next change *here*". Of 937 distinct change years, the single densest grid
cell holds 855 of them (91%), over Europe, so viewport-scoped acceleration is
near-inert while looking at Europe and dominant everywhere else. The project
owner was shown this concentration and chose to keep it rather than cap
acceleration -- see decision 0006 -- because it makes the dataset's uneven
real coverage legible on screen rather than hidden behind a uniform pace.

**Artifacts load whole and stay resident; there is no region-chunking.**
`versions.2.json` alone is 73.5 MB uncompressed on the real dataset, and all
three `versions.*` levels resident at once cost 331 MB of heap. That is
inside a desktop tab's ordinary budget, so nothing is chunked by region or
evicted once parsed. See `docs/decisions/0021-artifacts-load-whole.md` for
the full payload table, the deployed site's actual on-disk size once every
artifact was correctly staged (a gap Task 9 found and fixed), and the
measurement that would change this answer.

**Not yet validated by use.** Zoom and progressive level switching are
implemented and tested against synthetic and fixture data, but the project
owner has not yet used the deployed map at a real zoom level, over a dense
region and a sparse one, to judge whether the coarse-to-full upgrade is
visible in a way that distracts, or whether viewport-scoped acceleration
reads as intended. That judgement is this milestone's exit condition, the
same way palette and playback feel were Milestone 1's -- this document
records what was built and measured, not that a person has watched it run.

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
edge before simplification. It is measured, in
`packages/pipeline/tests/acceptance.test.ts`'s "simplification" suite, by
comparing **retained subsequences of shared arcs**.

Six earlier formulations failed, and they failed for one reason: each asked
"what surviving geometry is nearest this dropped point?", a question with no
removal-free answer, so each measured a sub-polygon being *removed* rather than
a border *moving*. The formulation that works never looks at polygons. Every
full-detail edge is keyed direction-independently with the set of version ids
using it; edges with two or more users are grouped by their exact co-user set
and chained into maximal polylines. Each polyline is a shared arc, defined
entirely from the full data. Because mapshaper drops vertices but never
relocates them (0 of 2,400,206 coarse vertices are absent from the rescaled
full-detail vertex set), each side's simplified border along an arc is exactly
the retained subsequence of that arc's own points, and the two sides compare
directly by Hausdorff distance. Ring identity across simplification - which the
six attempts believed was required and could not be had - turns out not to be
needed. A side retaining fewer than two of an arc's points has dropped the arc:
that is a removal, counted separately and not measured.

Measured on the real dataset, both levels seeing the same 22,215 shared arcs
(arcs of at least three points, so none can be trivially identical):

| level | identical | one side dropped | displaced | p99 |
|---|---|---|---|---|
| coarse | 21,058 (94.8%) | 1,150 | 7 | 0.7583 px |
| mid | 21,508 (96.8%) | 700 | 7 | 0.7583 px |

**Both levels meet the one-pixel bound**, measured as decision 0020 amends
it: p99 displacement across shared arcs, at one shared reference scale
(`DISPLACEMENT_REFERENCE_SCALE` = 258.6242 px/unit, `fitScale(1400, 900)`),
rather than the maximum at each level's own guessed, mismatched scale. The
original measurement above found the maximum could not tell coarse from mid
apart at all -- the same seven world-space events, ~0.0029 projected units
each, produce coarse's and mid's worst case identically; mid only looked
eight times worse under the old criterion because its guessed `PX_PER_UNIT`
made an identical displacement map to a smaller pixel. See 0020 for the full
argument, including why a criterion evaluated at maximum zoom (which both
levels fail by roughly 48x, and which only the unsimplified reference level
can pass, trivially) was rejected too. The regression this criterion exists
to catch - per-group simplification cracking a shared border into hairline
gaps - remains separately gated by the noisy-shared-boundary test in
`packages/pipeline/tests/simplify.test.ts`, verified to fail when
simplification is rewritten to one mapshaper call per group instead of one call
for the whole group.

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
