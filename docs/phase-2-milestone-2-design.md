# Phase 2, Milestone 2 — implementation design

Zoom, level switching, and viewport-scoped playback.

Milestone 1 shipped a map that plays the whole world at coarse detail. This
milestone adds the dimension it deliberately left out: getting closer. That
turns out to touch the pipeline, the artifact contract, the renderer, the
engine, and one Phase 1 acceptance criterion.

Read `docs/architecture.md` first. Decisions 0002, 0006, 0013 and 0015 govern
most of what follows; one of them is amended here and one Phase 1 criterion is
replaced.

## Scope

In:

- Zoom and pan, with the viewport applied as a canvas transform (0002).
- Level switching across coarse, mid and full, with on-demand loading.
- Viewport-scoped `nextVisibleChange` (0006).
- Real level-switch thresholds, measured rather than guessed.
- The `changes.json` off-by-one fix in the pipeline, which everything above
  depends on.

Out:

- Hover, labels, territory names, the detail panel. Phase 3.
- Mobile and touch. Desktop, as Milestone 1.
- Chunking artifacts by region. Measured as unnecessary -- see below.

## Measurements that shaped this design

Taken against the full pinned build (13,380 versions), not the fixture.

### Payload and heap: chunking is not needed

| level | gzipped | raw | JSON.parse | heap resident |
|---|---|---|---|---|
| coarse (`versions.0`) | 2.89 MB | 33.9 MB | 77 ms | 120 MB |
| mid (`versions.1`) | 4.47 MB | 45.0 MB | 88 ms | 151 MB |
| full (`versions.2`) | 12.05 MB | 73.5 MB | 149 ms | 219 MB |

All three resident at once: **331 MB**. Transfer for all three is 19.4 MB
gzipped.

Parse time is not the bottleneck -- 149 ms at worst, which is a visible hitch
but not a freeze. Transfer is the cost, and 331 MB is heavy but well inside a
desktop tab's budget. So artifacts load whole, on demand, and are kept. A
region-chunked delivery format would be a large piece of pipeline and viewer
work bought for nothing at this dataset size; if the dataset grows by an order
of magnitude the answer changes, and this measurement is the thing to re-take.

Measured with `node --expose-gc`. A browser will differ, but not by an order of
magnitude.

### Path2D, the proximity graph and the palette (Task 1, on top of the 331 MB)

**Palette and proximity graph: negligible, measured.** `buildPalette`
(`packages/viewer/src/render/palette.ts`), which builds the co-visibility and
proximity graphs internally and discards them once colours are assigned,
measured against the real `versions.2.json` with `node --expose-gc`:

| | heap |
|---|---|
| after loading `versions.2.json` alone | 79.3 MB |
| immediately after `buildPalette`, before gc (transient peak: covisibility graph, proximity graph, interval maps, all still live) | 86.0 MB (+6.7 MB) |
| after `buildPalette` + forced gc (retained: the `Palette` closure only) | 79.3 MB (+0.0 MB) |

The graphs cost about 7 MB transiently while being built and colour-assigned,
then collect back to nothing measurable -- `buildPalette` is called once per
renderer construction and its graphs are not kept. This does not move the
memory story.

**Path2D: analytical estimate, not a measurement.** `Path2D` is a browser
canvas API with no Node equivalent, and this project intentionally carries no
jsdom/canvas dependency (`packages/viewer` has none -- see its `package.json`)
for a build pipeline that otherwise never touches a DOM, so it cannot be
constructed or measured here the way the palette was. Estimated instead from
vertex counts and typical native path backing (roughly 8-24 bytes per vertex,
covering the range from a single-precision two-float point to a more
conservative double-precision-plus-verb encoding):

| level | vertices | Path2D estimate (all versions cached) |
|---|---|---|
| coarse | 2,400,206 | 19-58 MB |
| mid | 2,835,905 | 23-68 MB |
| full | 3,422,830 | 27-82 MB |

`canvas.ts`'s path cache is bounded at one `Path2D` per version with no
eviction (`pathFor`), so over a long scrub session it can grow to hold every
version's path at the active level -- the totals above are that worst case,
not the typical one (the plan already notes only ~195 paths are visible at
once; the cache holds visited-but-off-screen versions too). "The path cache is
per level, and only the active level's is kept" bounds this to one level's
total at a time, not three summed.

Even at the high end (82 MB for full, worst case, all 13,380 versions visited
in one session) this adds roughly a quarter to the 331 MB artifact baseline,
not a multiple of it. Consistent with the plan's expectation: this does not
change the design.

### The maximum cannot discriminate between levels

Phase 1 measured border displacement per shared arc and found coarse's worst at
0.759 px and mid's at 6.066 px -- but **the same seven world-space events**,
about 0.0029 projected units each. Mid only looks worse because
`PX_PER_UNIT.mid` makes its pixel smaller for an identical displacement.

That has a consequence Phase 1 did not draw out: a max-based criterion can
never distinguish coarse from mid, because their maxima are the same seven
arcs. Any threshold rule built on the maximum would say "go straight to full",
and any retightened max-based criterion would fail mid again for the same
reason it failed before.

The percentile does discriminate. A proxy over 4,030 of 120,881 shared
full-detail edges:

| level | edges losing an endpoint | p50 | p90 | p99 |
|---|---|---|---|---|
| coarse | 31.8% | 2.51e-3 | 6.26e-3 | 1.51e-2 |
| mid | 20.9% | 1.81e-3 | 4.32e-3 | 1.13e-2 |

**These absolute figures are not usable and must not be copied forward.** The
proxy bounds displacement by edge length rather than perpendicular deviation
from the chord, which grossly overstates -- it implies coarse breaks one pixel
at scale 160 when the fit-to-window scale is already 258.6 and Phase 1's proper
Hausdorff measurement puts coarse at 0.759 px there. The proxy establishes one
thing only, and it is the thing this design needed: the percentile improves
markedly from coarse to mid where the maximum does not.

Task 1 redoes this with the real Hausdorff measurement from
`packages/pipeline/tests/acceptance.test.ts` against the full build, and its
output sets the thresholds and the criterion.

### Threshold viability check (Task 1, real measurement)

**The percentile does not discriminate either. This is the risk the plan
called out as plausible, and it happened.**

Measured with `measureDisplacement` (extracted into
`packages/pipeline/src/stages/displacement.ts`) against the full pinned build
-- 13,380 versions, both levels seeing the same 22,215 shared arcs -- via
`pnpm build && pnpm displacement`:

| level | arcs | identical | dropped | displaced | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|---|
| coarse | 22,215 | 21,058 (94.8%) | 1,150 | 7 | 0.001592 | 0.002932 | 0.002932 | 0.002932 | 0.002932 |
| mid | 22,215 | 21,508 (96.8%) | 700 | 7 | 0.001593 | 0.002932 | 0.002932 | 0.002932 | 0.002932 |

(projected units; at 258.6 px/unit, p99 is 0.758 px for both levels)

Both levels have exactly **7** displaced arcs, and they are the same seven
world-space events at both levels -- the same finding Phase 1 made about the
maximum, and it turns out to also be true of p90, p95 and p99, because with
only 7 non-zero values out of 22,215 arcs, `floor(0.9 * 7)` through
`floor(0.99 * 7)` are all index 6: the same single largest value as the
maximum. p50 (index 3 of 7) is the only percentile that differs at all between
levels, and it differs by 0.06%, well inside noise.

**Coarse's and mid's p99 are 0.002932 and 0.002932 projected units -- a
difference under 0.02%, nowhere near the 20% threshold this plan set for
stopping.** Per the plan: *"If coarse's and mid's p99 figures come back within
roughly 20% of each other, stop and report that rather than picking thresholds
anyway."* This task stops here. **No thresholds are set.**

Why this happened: the metric only has a non-zero displacement on an arc where
simplification moves a retained point without dropping the whole side (a
"displaced" arc, as opposed to a "dropped" one). That population is tiny --
7 arcs out of 22,215, 0.03% -- and it is apparently the *same* 7 arcs at both
simplification levels, because whatever geometric feature causes them to
retain-but-shift is a property of the arc's shape, not of how aggressively it
is simplified. The design's premise -- "percentile discriminates where the
maximum does not" -- assumed a broader tail of displaced arcs whose severity
would vary with simplification aggressiveness. That tail does not exist for
this dataset at these two levels: the displaced population is a handful of
outliers, not a distribution, so every percentile above the median lands on
the same outliers the maximum already found.

**This is a question for the project owner, not something to paper over.**
Level switching's fidelity justification -- "each level's threshold is where
its own p99 crosses one screen pixel" (Decision 5, above) -- does not produce
two different thresholds from this data; it produces the same number twice.
The options, none of them mine to choose:

1. Drop per-level fidelity thresholds entirely and pick level-switch scales on
   a different basis (payload size, e.g. "switch to mid where its 4.47 MB is
   worth the fetch"), accepting that fidelity is not what discriminates them.
2. Keep percentile-based thresholds but measure a different quantity -- e.g.
   the identical-fraction (94.8% vs 96.8%, which *does* separate) or per-arc
   RMS displacement rather than per-arc worst-case, which would not collapse
   onto the same 7 outliers.
3. Accept that this dataset's geometry does not support the milestone's
   original two-tier fidelity story, and treat mid as existing for payload
   reasons only, not fidelity ones.

The `measureDisplacement` stage and its CLI (`pnpm displacement`) are built
and correct regardless of which option is chosen -- they are what produced
this finding, and whichever metric replaces per-arc-worst (if any) can reuse
the same shared-arc construction.

### The real viewport scale

258.6 px per projected unit at 1400x900, 354.7 at 1920x1080, both width-bound.
`canon.ts`'s provisional `PX_PER_UNIT.coarse` guess of 259 is near-exact at
1400 wide -- which is luck, not vindication: `mid` at 2069 and `full` at 16552
assume fixed 8x and 64x steps that this milestone replaces with measurements.

### Change-year density is overwhelmingly European

Of 937 distinct change years, the single densest grid cell holds 855 (91%), and
a four-cell viewport over Rome sees 92.5%. Viewport-scoped playback will
therefore be near-inert over Europe and dominant everywhere else. The project
owner was shown this and chose it knowingly; see Decisions below.

## Decisions taken while brainstorming

1. **Full scope.** All three levels, not a coarse+mid subset, and not split
   across two milestones.
2. **Progressive loading.** The coarser level keeps drawing while a finer one
   fetches, swapping in silently on arrival. Never blocked, never blank.
3. **Mid is prefetched, full is earned.** Mid starts after first paint at low
   priority; full waits until the user has zoomed once. See "Prefetching".
4. **Playback stays viewport-scoped and 0006 is not amended.** No cap on
   acceleration; 0006's logarithmic dead time stands. The asymmetry is the
   intent: you should not wait on Europe while looking at the Pacific, and it
   makes the dataset's uneven coverage legible rather than hidden.
5. **Thresholds come from measurement.** Each level's threshold is the scale at
   which that level's p99 displacement crosses one screen pixel.
6. **Artifacts load whole and stay resident.** No chunking, no eviction of
   parsed artifacts.

## Prefetching

On-demand loading alone means the first zoom always shows stretched coarse
geometry for a second or two before sharpening. Preloading everything removes
that but blocks the first paint behind 19.4 MB. Deferring the prefetch until
after first paint gets both: the first paint still costs only coarse's 2.89 MB,
and the rest arrives while the map is already playing.

The three levels do not deserve equal eagerness:

| level | size | who needs it |
|---|---|---|
| coarse | 2.89 MB | everyone, immediately |
| mid | 4.47 MB | anyone who zooms at all |
| full | 12.05 MB | only deep zoom |

Full is 62% of the bytes and serves the rarest case. So:

- **Coarse** loads and paints as it does today.
- **Mid** starts immediately after first paint, at low priority. It covers the
  first zoom step anyone takes, so the visible softening disappears for the
  common path.
- **Full** starts only once the user has actually zoomed once -- evidence they
  are exploring rather than glancing.

The common path therefore costs 7.36 MB rather than 19.4 MB.

Two rules this depends on:

- **The prefetch must not compete with anything the user triggered.** Issue it
  with `fetch(url, { priority: "low" })` so the browser deprioritises it
  against interaction-driven requests.
- **Progressive rendering remains the fallback, not a legacy path.** Prefetch
  is an optimisation and can lose: on a slow connection a user will out-zoom
  the download. The coarser-level-keeps-drawing behaviour must catch that
  case, and must be tested as the live path it is rather than treated as dead
  code once prefetch works.

The cost, stated plainly: every visitor now pays 4.47 MB and roughly 150 MB of
heap whether they ever zoom or not. On desktop, which is this milestone's
stated target, that is acceptable. It is the first thing to revisit if mobile
comes into scope.

## The pipeline fix, which lands first

`changes.json` cannot answer the question viewport-scoped playback asks. It
buckets `fromYear` and `toYear` into grid cells indistinguishably, but a
fade-out begins at `toYear + 1`, so the moment playback needs is unrecoverable
from what is stored. Milestone 1 sidestepped it by deriving event years from
version rows, which is exact only because with no zoom the viewport is the
world.

Once the viewport is a sub-region, the index is the only structure that can
answer "what changes *here* next", so it must be right.

`packages/pipeline/src/stages/change-index.ts` buckets `fromYear` and
`toYear + 1` rather than `fromYear` and `toYear`. The artifact's 937 recorded
years collapse to the 509 real transition moments. This re-blesses the golden
fixture, and decision 0013 gains a line recording the correction.

This ships as its own change, before the viewer work, because everything else
depends on it and because a fixture re-bless is easier to review on its own.

## The renderer

### `transform.ts`

`Viewport` grows from "fit the world" to a centre in projected units plus a
scale in pixels per projected unit. `fitWorld` becomes the initial state and
the reset action rather than the only state.

Zoom anchors at the pointer: the projected coordinate under the cursor stays
fixed across the zoom. Pan is a drag. Both clamp -- no zooming out past fit, no
panning the world off screen.

`fromScreen` already exists and has no production caller; it becomes
load-bearing here, mapping pointer positions to projected coordinates.

### `canvas.ts`: paths move to world space

Decision 0002 says pan and zoom are a canvas transform. They currently are not:
`buildPath` bakes screen coordinates into each `Path2D` via `toScreen`, and
`resize()` clears the cache because those coordinates are valid for exactly one
viewport.

Under continuous zoom and pan that cache would be invalidated every frame --
195 paths rebuilt per frame at up to 20,000 vertices. That would make zoom the
slowest thing in the application and would quietly repeal decision 0015's
finding that no caching is needed, since 0015 measured fills of a *cached*
path set.

So paths are built once in world space and the viewport is applied via
`ctx.setTransform`. The cache then survives pan and zoom entirely and is
rebuilt only on a level switch.

Two consequences:

- **Stroke widths are screen measurements and must stay so.** The 0.75 px
  polity seam and 1.5 px empire boundary are divided by the current scale
  before stroking. Without this, borders thicken as you zoom until the map is
  all outline.
- **`PX_PER_UNIT` stops being a renderer constant.** The renderer consults
  `viewport.scale`, which varies continuously. The `canon.ts` values survive
  only as the reference scales at which the acceptance criterion is measured.
  This must be stated in `canon.ts` itself, because a future reader will
  otherwise expect the renderer to use them.

### Level switching

The level follows `viewport.scale` through the two measured thresholds.

- **Hysteresis.** The switch up happens at the threshold; the switch back down
  only below 0.8x it. On a bare threshold, nudging the wheel across the
  boundary triggers a 12 MB fetch and nudging back triggers another.
- **The path cache is per level, and only the active level's is kept.** Each
  level has its own `coordScale`, so a path built for coarse is meaningless for
  mid. Three resident caches over 13,380 versions would add materially to the
  331 MB. Paths are built lazily for what is drawn, so dropping the inactive
  cache costs a rebuild of the roughly 195 visible paths. The parsed artifacts
  stay -- refetching 12 MB is far worse than rebuilding a few hundred paths.
- **Land has only two levels.** The pipeline emits `land.0` and `land.1`; there
  is no `land.2`. The basemap switches coarse to mid and then stops, however
  far you zoom. "Detail level" is therefore not one global number and the code
  must not pretend it is.
- **A failed fetch does not retry in a loop.** Stay on the current level,
  surface it quietly, and do not re-attempt on every subsequent zoom event. A
  12 MB request retried per wheel tick looks like a hang.

## The engine

`ChangeYears` switches from row-derived to index-backed. Milestone 1 derives
event years from version rows because the index could not answer the question;
with the index fixed, it can, and 0006 states the requirement directly. A query
takes the cells overlapping the viewport bounding box, unions their year lists,
and returns the next year above the current one.

**`cellRangeFor` migrates from `packages/pipeline` to `packages/model`.**
Mapping a bounding box to grid cells is part of interpreting the artifact, not
part of building it, and the viewer may never import from the pipeline. It
belongs in the contract beside `GRID`.

The engine stays DOM-free. It receives a bounding box as plain projected-unit
numbers computed in `render/` and handed down -- never a viewport object, never
a DOM event. This is the boundary most likely to erode in this milestone,
because the natural thing to pass is the thing `render/` already has.

## The acceptance criterion changes shape

`docs/phase-1-importer.md` states the no-new-gaps criterion as a one-pixel
bound on the maximum. As measured above, the maximum is the same seven arcs at
both coarse and mid, so a max-based criterion cannot distinguish the levels and
mid cannot pass it at any threshold.

The replacement is per-level and percentile-based: **at each level's own
threshold scale, that level's p99 displacement stays under one screen pixel.**

Each level can meet it; it tests typical border fidelity at the zoom that level
actually serves; and it is computed from the same measurement that sets the
thresholds, so the constants and the test cannot drift apart.

This amends a Phase 1 acceptance criterion and gets its own decision record,
arguing against the max-based version explicitly rather than replacing it
quietly.

## Thresholds: what the measurement actually showed

Task 1 measured border displacement per shared arc at both levels against the
full build. The result killed the rule this design originally proposed:

```
coarse: 22,215 arcs | identical 21,058 (94.8%) | dropped 1,150 | displaced 7
mid:    22,215 arcs | identical 21,508 (96.8%) | dropped   700 | displaced 7
        p50 0.00159   p90/p95/p99/max 0.002932 at BOTH levels
```

p99 is **identical** at coarse and mid, not merely close. Simplification on
this dataset does not move borders, it removes them: 94.8% of shared arcs come
through byte-identical, and only seven are displaced at all -- the same seven
events at both levels, so a seven-member distribution puts every percentile
above p50 on the same index.

The earlier proxy in this document appeared to show the percentile
discriminating. It did not measure displacement; it measured endpoint drops.
**The drop rate discriminates -- 1,150 against 700. Displacement does not.**

Measuring how far a border moves where an arc was dropped is exactly what broke
Phase 1's six failed formulations: "what surviving geometry is nearest this
dropped point" has no removal-free answer. So a pixel-denominated *fidelity*
threshold is not available from this data, and asserting one would break the
project's core rule.

**The thresholds therefore come from retained-vertex spacing.** Task 6 measures
the typical spacing between retained vertices per level and sets each threshold
where that spacing exceeds a few screen pixels -- the scale at which the
straight segments simplification left behind become visible. The acceptance
criterion follows: *at each level's threshold scale, retained-vertex spacing
stays under N screen pixels*. That measures detail density rather than border
error, which is what the data supports.

## Acceptance criteria

Named tests, run by `pnpm test` against `fixtures/dist`.

**Transform**

1. Zooming at a point leaves that point's projected coordinate fixed, across a
   sweep of zoom factors and anchor positions.
2. Pan and zoom compose: any sequence of pans and zooms followed by reset
   returns exactly the fit-to-window viewport.
3. `toScreen` and `fromScreen` round-trip to within one pixel at every zoom
   level tested, not only at fit.
4. Zoom clamps at fit on the way out, and pan cannot move the world entirely
   off screen.

**Level selection**

5. Each threshold selects the level the measurement assigns to that scale.
6. Hysteresis holds: crossing a threshold upward then returning slightly below
   it does not switch back until 0.8x.
7. Land selection saturates at mid and never requests a level the pipeline does
   not emit.

**Prefetching**

8. Mid is requested after first paint and not before it; full is not requested
   until a zoom has occurred. Asserted against a recording of request order,
   not by timing.
9. A level already resident is never re-requested, however many times zoom
   crosses its threshold.

**Change index**

10. `nextChangeAfter(year, bbox)` returns the smallest event year strictly
   greater than `year` among cells overlapping `bbox`, and null past the end.
11. A bbox covering the whole world returns exactly the same sequence the
   row-derived Milestone 1 implementation returns -- the two must agree where
   their domains overlap.
12. `cellRangeFor` in the model maps a bbox to the same cells the pipeline used
    when building the index.

**Pipeline**

13. `changes.json` buckets `fromYear` and `toYear + 1`; the artifact's distinct
    year count over the full build is 509, not 937.
14. The build stays deterministic and byte-identical across two runs.

**Checked in the full-build workflow, not the test suite**

15. At each level's threshold scale, that level's p99 displacement is under one
    screen pixel. This needs the real dataset; the fixture's 620 shared arcs
    are too thin a slice to characterise a percentile.

**Milestone exit condition, not a test**

16. The project owner zooms into a dense region and a sparse one and judges
    whether viewport-scoped acceleration reads as intended given the 91%
    concentration, and whether level switching is visible in a way that
    distracts.

## New decision records to author

**Percentile displacement replaces the maximum.** Records that the maximum is
the same seven arcs at coarse and mid, so it cannot discriminate; that the
percentile does; and that the criterion is now measured at each level's own
threshold scale. Without the measurement written down, a future reader will
restore the max-based rule as the more obviously correct one.

**Artifacts load whole, and why chunking was rejected.** Records the payload
and heap table, and that 331 MB resident is inside a desktop budget. The
instinct on seeing a 73 MB artifact is to chunk it by region; this says why
that is not worth building yet, and names the measurement that would change the
answer.

## Risks

**The engine's spatial boundary.** This milestone makes the engine spatially
aware for the first time. The DOM-free rule has held through Milestone 1
because the engine had no reason to know about pixels; now it has a bounding
box, and the shortest path from `render/` is to pass the viewport itself.
Review should watch this specifically.

**Realized: Task 1's measurement does not separate the levels.** The proxy was
loose, and the real Hausdorff measurement shows coarse's and mid's p99 at
0.002932 projected units each -- under 0.02% apart, the same seven world-space
events already found at the maximum. See "Threshold viability check (Task 1,
real measurement)" above. No thresholds are set; the project owner needs to
choose one of the options recorded there before level switching's fidelity
story can be finished. This blocks Decision 5 and item 15 of the acceptance
criteria, and likely the decision record "Percentile displacement replaces the
maximum" needs to be rewritten once a direction is chosen, not merely filed as
planned.

**331 MB is artifacts only.** Path2D objects, the proximity graph and the
palette sit on top and are unmeasured. Unlikely to change the design, but the
memory story is not settled until Task 1 measures it.

## Out of scope

- **Hover, labels, the detail panel.** Phase 3. The artifact contract already
  carries `anchor` for label placement, so nothing here blocks it.
- **Mobile and touch.** Desktop, as Milestone 1.
- **Region-chunked artifacts.** Measured unnecessary; recorded with the number
  that would change the answer.
- **The empire outline weight.** Owner asked to tune it after more use. One
  constant, `AGGREGATE_OUTLINE_WIDTH`; not a milestone concern.
