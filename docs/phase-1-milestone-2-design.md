# Phase 1, Milestone 2 — implementation design

Companion to `docs/phase-1-design.md`, which covers Phase 1 as a whole and
records the Milestone 1 architecture. This document designs what closes the
phase: the two coarser detail levels, the spatially-bucketed change-year index,
and the playback-density diagnostic.

`docs/phase-1-importer.md` remains the canonical spec. Where it and this
document disagree, it wins on *what* and this one wins on *how*.

## Scope

> The Milestone 2 implementation plan lived at `docs/phase-1-milestone-2-plan.md`
> and was removed once the milestone landed, the same as Milestone 1's: its
> content is absorbed by the code, the tests, decision record 0013 and this
> document, and stale code snippets are worse than none. Recover it with
> `git show 42cd3aa2e6ec8c9698ad553b1d413e2a39c4d1a6:docs/phase-1-milestone-2-plan.md`.


Four things, shipping together:

1. **Simplification** — `versions.1.json` (mid) and `versions.0.json` (coarse),
   topology-preserving, from the existing full-detail geometry.
2. **The change index** — `changes.json`, backing decision 0006's
   viewport-scoped `nextVisibleChange`.
3. **The histogram** — a diagnostic measuring how much of the timeline adaptive
   playback would fast-forward through. Restores a Phase 0 capability that was
   deleted with the spike.
4. **The three remaining acceptance criteria**, plus extending the existing
   geometry criteria to the two new levels.

Milestone 1 delivered fetch, normalise, identity, lineage, projection and emit,
producing a validated full-detail artifact set. This milestone closes Phase 1.

## Measurements that shaped this design

Every number below was measured against the pinned Cliopatria v0.2.0 release and
the Milestone 1 build output. They are recorded because three of them changed
the design away from what the Milestone 1 plan sketched.

### Neighbouring polities share vertices, heavily

| | |
|---|---|
| total vertices across all polity rows | 3,422,830 |
| distinct vertex positions | 104,966 |
| positions used by more than one polity | 78,324 (74.6%) |

Cliopatria was evidently digitised against a shared set of nodes rather than by
tracing each polity independently. This is the finding that makes
topology-preserving simplification worth doing: mapshaper will detect real
shared arcs, so simplification moves a shared border identically on both sides
and gaps cannot open. Had the share rate been near zero, the "no new gaps"
acceptance criterion would have been unachievable by this route and the design
would have needed rethinking.

### A version's bounding box is a poor spatial proxy; a polygon's is good

Indexing each version by its overall projected bounding box, versus indexing
each of its polygons separately:

| grid | per-version entries | worst version | per-polygon entries | worst polygon |
|---|---|---|---|---|
| 32x16 (512 cells) | 496,288 | 390 cells (76%) | 191,386 | 60 cells (12%) |
| 64x32 (2048 cells) | 1,682,966 | 1,479 cells (72%) | 471,954 | 207 cells (10%) |

A scattered empire's bounding box covers most of the world while its territory
is fragments. Indexing per polygon cuts index size by about 70% and worst-case
spatial fan-out from roughly three quarters of the map to a tenth. The Milestone
1 plan proposed per-version bucketing; this design does not.

### After deduplication the index is negligible at any resolution

| grid | cells | deduped years | raw | gzipped | densest cell |
|---|---|---|---|---|---|
| 24x12 | 288 | 46,309 | 218 KB | 9 KB | 913 |
| 32x16 | 512 | 73,537 | 346 KB | 12 KB | 894 |
| 48x24 | 1,152 | 139,373 | 656 KB | 22 KB | 886 |
| 64x32 | 2,048 | 226,103 | 1,064 KB | 33 KB | 855 |

Grid resolution is therefore chosen for query precision, not size. Note the
densest cell barely shrinks as the grid refines: dense regions are genuinely
dense, with roughly 900 distinct change years out of a 5,400-year span.

### Current artifact sizes, as the simplification budget

`versions.2.json` is 76,757,012 bytes raw and 12.6 MB gzipped. The 8 MB gzipped
budget applies to the coarsest artifact only.

## Simplification

Simplification runs **inline inside `build`**.

An earlier draft of this design proposed a separate cached `pipeline simplify`
command, following the pattern Milestone 1 used for `fetch`. That pattern fits
`fetch` because it is slow *and* impure. Simplification is neither. It is
deterministic, and it consumes projected geometry that only `build` produces --
so a separate command must either duplicate the whole pipeline or create a
circular dependency, with `build` needing `simplify`'s output and `simplify`
needing `build`'s. It would also require a second committed tree under
`fixtures/` for `fixture:bless` to work. Inline avoids all three. If a full run
proves slow enough to be painful, caching becomes a measured decision rather
than an assumed one.

**mapshaper**, via its programmatic API, at a pinned version.

**Input is projected integer geometry, not lon/lat.** Two reasons. The gap
criterion is stated in screen pixels, which live in projected space, so
measuring it there measures it where it is defined. And Equal Earth is
equal-area, so a Visvalingam area threshold means the same real area everywhere;
in degrees the same threshold would simplify far more aggressively near the
poles, where a degree of longitude is short.

**All polygons go through one mapshaper call per level.** Shared topology is the
entire mechanism by which borders stay aligned, and it only works if neighbours
are in the same call. A consequence worth a code comment: a border shared
between two polities that never appear on screen together is topologically
linked too, which slightly over-constrains simplification. That is harmless and
must not be "optimised" into per-polity calls.

**Each level is derived independently from full detail**, not coarse-from-mid,
so simplification error does not compound.

**`keep-shapes` is on**, so small polities cannot vanish. A state disappearing
because it was small is exactly the kind of silent falsehood this project
forbids.

**Land is not simplified.** Natural Earth's 110m and 50m releases are
cartographer-generalised and already constitute the two land levels: `land.0`
serves the coarse view, `land.1` serves both mid and full. Re-simplifying
generalised data would degrade it for no gain, and neither file is a size
problem at 71 KB and 954 KB.

**Tuning targets fidelity, not the budget ceiling.** The intent is the least
aggressive simplification that meets the budget, not the most aggressive that
fits. Coarse aims at roughly 3-5 MB gzipped against the 8 MB limit; mid lands
where it lands. Actual percentages are measured during implementation and
recorded in `canon.ts`, not guessed here.

**Quantisation is safe at the existing scales.** Coarse stores at 1e5, giving
about 386 integer units per screen pixel on a 1400-pixel global view, so
rounding error is under a thousandth of a pixel. Identical inputs still round
identically, so shared arcs stay shared through quantisation.

## The change index

`changes.json`, a uniform grid over the projected world:

```
{
  schemaVersion: number,
  grid: { cols: number, rows: number, bounds: [minX, minY, maxX, maxY] },
  cells: number[][]        // row-major; each a sorted, deduplicated year list
}
```

A cell's list holds every year in which anything overlapping that cell starts or
ends -- both `fromYear` and `toYear` of each version.

**Membership is per polygon, not per version**, for the reasons measured above.

**Grid is 64x32**, 33 KB gzipped. Because the projection is equal-area, uniform
cells in projected space mean uniform *real area* per cell rather than uniform
degrees.

**The query** backing decision 0006's `nextVisibleChange`: take the cells the
viewport overlaps, merge their sorted lists, return the first year past T. The
densest cell holds 855 years, so even a wide viewport merges a few thousand
integers.

**A known imprecision, stated rather than hidden.** A polygon's bounding box is
not the polygon, so a query can report a change just outside the visible shape.
The failure mode is a brief pause for something slightly off-screen: the map
shows more than strictly necessary rather than skipping something real, which is
the correct direction for this project. Making membership exact would require
polygon-cell clipping written solely to answer a membership question, which is
not worth it for a precision nobody has yet shown a need for.

## The histogram

`pipeline histogram`, a developer diagnostic. It reads `dist/`, so it measures
the shipped artifacts and therefore what playback will actually feel like.

It exists because decision 0006's adaptive speed could be a garnish or the
dominant experience, and `docs/phase-0-findings.md` says the difference matters:
at 20% of the timeline accelerated it is a map that occasionally skips ahead, at
80% it is a fast-forward button with occasional pauses, "a materially different
product". Phase 0 asked for this to be run before Phase 2 UX work; the script
that produced it was deleted with the spike.

**Regions.** The four Phase 0 bounding boxes are restored verbatim so results
stay comparable to that baseline: Mediterranean `[-10, 25, 45, 50]`,
Sub-Saharan Africa `[-18, -35, 52, 15]`, Southeast Asia `[92, -11, 141, 29]`,
World. `--bbox=minLon,minLat,maxLon,maxLat` and `--from` / `--to` cover anything
else. These live in `packages/pipeline/src/regions.ts`: pipeline-only, not part
of the artifact contract, so not in `model`.

**Output.** Distinct change-years per time bucket as an ASCII chart, plus the
acceleration profile -- at a base speed and dead-time ceiling D, the fraction of
the timeline that must be fast-forwarded. Defaults are 4 years/second and D = 7
seconds, the values Phase 0 settled on. `--out` writes JSON.

**One detail that will bite if missed:** regions are given in lon/lat but the
index is projected, and Equal Earth curves. Projecting a box's four corners
understates its extent; the conversion must sample along the edges, as the
spike's `projectedBoundsOf` did.

## Acceptance criteria

Three new, plus extending the existing geometry criteria to `versions.0.json`
and `versions.1.json`.

**No previously-adjacent polygons gain a gap wider than one screen pixel.**
Tested in two layers, because shared topology permits the stronger form:

1. *Topology preserved.* Every vertex position that two polygons shared at full
   detail, and that survives simplification in one of them, must also survive in
   the other. Where mapshaper kept the arc shared, separation is exactly zero
   rather than merely small. This is the real guarantee and the thing that would
   break if anyone swapped in per-polygon simplification.
2. *Pixel distance.* The criterion as literally stated, measured against
   provisional pixels-per-unit figures in `canon.ts` -- coarse about 259 px/unit
   for a 1400-pixel global view, mid about 2069. These encode a Phase 2
   assumption that does not exist yet and are marked provisional in the source.

**For 1,000 random (year, bbox) pairs, the index lookup matches a brute-force
scan.** Worth being precise about what this proves: the brute-force scan must
use the same per-polygon-bounding-box predicate, so the test verifies the index
correctly implements its own definition. It cannot detect the bbox-versus-
geometry imprecision described above, which is a documented property rather than
a defect.

**The coarsest global artifact is under 8 MB gzipped.** A real assertion,
replacing the current `full-build.yml` step that prints sizes and can never
fail.

## Changes to existing code

| File | Change |
|---|---|
| `packages/model/src/canon.ts` | add `PX_PER_UNIT` (provisional) and `GRID`; record measured simplification percentages |
| `packages/model/src/types.ts` | add `ChangesArtifact` |
| `packages/pipeline/src/stages/emit.ts` | write three version levels and `changes.json`; extend the manifest |
| `packages/pipeline/src/build.ts` | consume simplified geometry, build the index |
| `packages/pipeline/src/cli.ts` | `simplify` and `histogram` subcommands |
| `packages/pipeline/package.json` | mapshaper dependency |
| root `package.json` | `simplify` and `histogram` scripts |
| `packages/pipeline/tests/acceptance.test.ts` | three new criteria; existing geometry criteria extended to the new levels |
| `fixtures/dist/` | re-blessed; now eight artifacts |
| `.github/workflows/full-build.yml` | assert the 8 MB budget rather than printing it |
| `docs/architecture.md`, package READMEs | describe the new stages and artifacts |

New source files: `stages/simplify.ts`, `stages/change-index.ts`,
`stages/histogram.ts`, `regions.ts`. (`change-index.ts` rather than `index.ts`,
which inside a `stages/` directory would read as a module index.)

## New decision record

**0013 — the change index buckets polygons, not versions.** Carries the
measurements above: 72% of the map claimed by a single version's bounding box
versus 10% per polygon, and the roughly 70% reduction in index size. Without the
evidence recorded, this reads like an unnecessary complication and a future
contributor would reasonably simplify it back.

## Risks

**mapshaper determinism is the main one.** It is the first dependency doing real
geometric work, and Milestone 1's determinism guarantee is scoped to a pinned
toolchain (decision 0010). If mapshaper's output varies between runs, the golden
fixture artifacts become noise and the byte-identical rebuild criterion fails.
This must be verified first -- a twice-run byte comparison on real geometry,
before anything is built on top -- rather than discovered at the acceptance-test
stage.

**Topology across 104,966 distinct vertex positions** is well within mapshaper's
range, but the one-call-per-level design means memory and time scale with the
whole dataset at once. Worth measuring early; the fallback, if needed, is
simplifying in geographically disjoint batches, which preserves shared arcs
within a batch but not across batch boundaries -- an explicit trade that would
need its own decision.

## Noted for Phase 2, not decided here

**Playback speed control contradicts decision 0006 as currently written.** 0006
says the user's slider is a floor and the system keeps accelerating through gaps
above it: "The system only ever accelerates through emptiness, never drags below
what was asked for." The project owner's stated intent is different -- once the
user sets a specific speed, that speed should be respected rather than silently
overridden. That is a defensible amendment, arguably a better one, but it amends
an accepted record and belongs in its own decision when Phase 2 builds playback.

**A per-region default speed** was also raised: deriving a baseline speed from
how coarse the data is in the current viewport, distinct from 0006's continuous
per-gap adaptation. The two are compatible and both are served by the same
`changes.json` query, so neither changes this milestone. Tabled until the
histogram provides real density numbers to decide against.

## Out of scope

- **The viewer.** Phase 2.
- **`RELATION` rows.** Still dropped; rendering them is a Phase 3 question.
- **`confidence`.** Stays null; no licensed source exists (decision 0005).
- **Spatial chunking of full detail.** Level-of-detail splits by resolution, not
  region, so a deep regional zoom still fetches the whole full-detail artifact.
  If that becomes a real use case the answer is chunking static files, not a
  backend. Phase 3, with its own decision record.
- **The drift report.** Deferred past Phase 1; the schema stores what it needs.
