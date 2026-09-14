# 0020 — Percentile displacement at one shared scale replaces the per-level maximum

**Status:** accepted. Amends the no-new-gaps acceptance criterion in
`docs/phase-1-importer.md`.

## Context

Phase 1's acceptance criterion for simplification was: no border simplification
may open a gap wider than one screen pixel between two polygons that shared an
edge before simplification. It was measured as the **maximum** per-arc
Hausdorff displacement between full-detail geometry and each simplified level,
evaluated at that level's own entry in `PX_PER_UNIT`
(`packages/model/src/canon.ts`) -- coarse 259, mid 2069, full 16552 px/unit.
Those three numbers were a guess, made before any viewport existed, at a
1400px window showing the whole world at coarse, an eighth of it at mid, and a
sixty-fourth at full.

Milestone 2 Task 1 measured the real thing the guess stood in for and found
two problems at once.

**The maximum cannot discriminate the levels.** Measured against the full
pinned build (13,380 versions), both levels see the same 22,215 shared arcs:

| level | arcs | identical | dropped | displaced | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|---|
| coarse | 22,215 | 21,058 (94.8%) | 1,150 | 7 | 0.001592 | 0.002932 | 0.002932 | 0.002932 | 0.002932 |
| mid | 22,215 | 21,508 (96.8%) | 700 | 7 | 0.001593 | 0.002932 | 0.002932 | 0.002932 | 0.002932 |

(projected units; `measureDisplacement`, `packages/pipeline/src/stages/displacement.ts`,
run via `pnpm build && pnpm displacement`.)

Both levels have exactly **7** displaced arcs out of 22,215, and they are the
same seven world-space events (~0.0029 projected units, about 22 km) at both
levels. Under the old per-level-scale criterion, mid's guessed `PX_PER_UNIT`
(2069, eight times coarse's) made an *identical* world-space displacement
report as an eight-times-worse pixel figure (0.759 px at coarse's scale,
6.066 px at mid's) -- not because mid's geometry is worse, but because the
guessed scale was wrong. A max-based rule, at any scale, therefore reports
"coarse and mid are equally bad" when the geometry is exactly as bad and no
more: the same seven arcs, full stop. Retightening a max-based threshold does
not fix this -- it fails mid for the same seven arcs it already failed on.

**Percentile does not, by itself, fix this either.** With only 7 non-zero
values out of 22,215 arcs, `floor(0.9 * 7)` through `floor(0.99 * 7)` are all
index 6 -- the same single largest value the maximum already reports. p50
(index 3 of 7) is the only percentile that differs between coarse and mid at
all, by 0.06%, well inside noise. So naming the statistic "p99" instead of
"maximum" changes nothing about *this* dataset's numbers: they are identical
either way. What actually needed to change was the scale the criterion is
evaluated at, not the statistic.

## Decision

Replace the per-level-scale maximum with: **at one shared, real reference
scale, each level's p99 displacement across its shared arcs stays under one
screen pixel.**

The scale is `DISPLACEMENT_REFERENCE_SCALE` in `packages/model/src/canon.ts`,
set to `fitScale(1400, 900)` = **258.6242** px/unit -- the viewer's actual
fit-to-window scale (`packages/viewer/src/render/transform.ts`), not a guess.
There is only one scale now, not three, because Milestone 2 also measured and
dropped zoom-based level switching entirely (retained-vertex spacing, Task 6,
differs by at most 35% between levels with identical maxima -- see
docs/phase-2-milestone-2-design.md, "Thresholds: what the measurement actually
showed"): levels are a load order, not a zoom mapping, so there is no
"threshold scale" left for a level to own.

At that scale:

| level | p99 (projected units) | p99 in pixels |
|---|---|---|
| coarse | 0.002932 | 0.7583 |
| mid | 0.002932 | 0.7583 |

Both pass, under one pixel. Naming the statistic p99 (rather than maximum) is
kept even though it produces the identical number here, because it is the
correct statistic in general: a future dataset without this dataset's
particular 7-arc degenerate tail could have a genuine spread of displaced
arcs, and reporting "maximum" would then keep surfacing one arbitrary outlier
as if it characterised the whole level -- exactly the mistake made here.
Recording it as p99 is the version of this criterion that stays meaningful if
the tail's shape ever changes; recording it as "maximum" would not.

**How much room is left, stated plainly.** 0.7583 px at fit zoom is close to
the one-pixel ceiling. Unrounded, displacement first crosses one pixel at
`1 / 0.002932` = **341.1** px/unit, which is **1.319x** fit-to-window zoom.
Past roughly a 32% zoom-in, the same seven arcs would visibly move under
coarse or mid geometry -- full's real, unsimplified detail is the only thing
that removes those seven events at all, at any zoom. This is not a footnote:
it is the honest reading of why full exists, and it happens well within a
single ordinary zoom gesture, not at some remote edge case.

At the far end, maximum zoom (fit x `MAX_ZOOM_FACTOR` 64 =
**16551.9** px/unit -- note this is close to the old, now-deleted
`PX_PER_UNIT.full` of 16552, which was a coincidence of the old guess landing
near the max-zoom scale, not near any level's own scale) the same p99 is
**48.5 px**. That number matters only for the alternative this decision
rejects next.

## Rejected alternatives

**1. The Phase 1 maximum-based bound, kept as-is.** Already covered above:
the same seven world-space events are coarse's and mid's maximum at any
scale, so a max-based rule cannot tell the levels apart and any retightened
version of it fails mid for the same reason it failed before. This is why the
criterion is changing shape at all, not only its numbers.

**2. A criterion phrased at maximum zoom instead of fit zoom.** Evaluating
the same p99 displacement at 16551.9 px/unit (fit x 64) gives 48.5 px for
*both* coarse and mid -- a criterion of "under one pixel" fails both of them
by roughly 48x. Only `full`, the unsimplified reference geometry being
compared against itself, would pass, and it would pass trivially: zero
displacement at any scale, by construction. A criterion that nothing but the
reference case can pass, and that both real candidates fail by the same
degree, discriminates nothing and asserts nothing -- it is not a criterion.
Fit zoom is the scale where a real answer exists: coarse and mid both pass,
full is not needed to make it pass, and the criterion is doing its job of
bounding *typical* simplification fidelity rather than describing what
simplification is not designed to survive at 64x magnification.

## Consequences

- `docs/phase-1-importer.md`'s geometry criterion now reads "at
  `DISPLACEMENT_REFERENCE_SCALE`, each level's p99 displacement stays under
  one screen pixel" and points here rather than restating the reasoning.
- `packages/pipeline/tests/acceptance.test.ts`'s simplification test measures
  p99 against the fixture, but the fixture's 620 shared arcs are far too thin
  to characterise a percentile reliably. The number that actually gates a
  release runs in `.github/workflows/full-build.yml` via `pnpm displacement`
  against the real 22,215-arc dataset, and fails the build (nonzero exit) if
  either level's p99 is at or over one pixel.
- `packages/model/src/canon.ts`'s `PX_PER_UNIT` (three provisional,
  fixed-zoom-step guesses) is deleted and replaced by the single measured
  `DISPLACEMENT_REFERENCE_SCALE`. It is not a renderer constant: the renderer
  reads `viewport.scale` continuously as the user zooms (decision from the
  Milestone 2 design doc's "`canvas.ts`: paths move to world space" section).
  `DISPLACEMENT_REFERENCE_SCALE` only fixes the one scale this test is
  measured at, so the constant and the criterion cannot drift apart silently.
- If a future dataset re-opens this question, re-run
  `pnpm build && pnpm displacement` first. The 7-displaced-arc degeneracy is a
  property of this specific dataset's geometry, not a law; a dataset with a
  genuine spread of displaced arcs would make p99 and maximum diverge, and
  that divergence is exactly what would make the percentile choice earn its
  keep rather than merely match the maximum by coincidence.
