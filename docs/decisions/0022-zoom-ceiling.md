# 0022 — The zoom ceiling is 16x, set by the source geometry's resolution

**Status:** accepted. Amends the max-zoom figures in
`docs/decisions/0020-percentile-displacement.md` and the note in
`packages/model/src/canon.ts`.

## Context

`MAX_ZOOM_FACTOR` in `packages/viewer/src/render/transform.ts` was 64. It was
chosen in the Milestone 2 plan before there was a viewer to zoom, on no
stated basis beyond "full detail is what makes this useful" — the same class
of pre-measurement guess as the `PX_PER_UNIT` constants 0020 deleted.

The owner, using the deployed map, noticed that borders look faceted at high
zoom and asked whether the full-detail artifact was really loading. It was:
all three version levels return HTTP 200 from the deployed site and
`versions.2.json` is served at its full 77 MB. The faceting is not a loading
failure and not a simplification artefact. `SIMPLIFY_PERCENT.full` is 100 —
full is Cliopatria's own geometry, with no Visvalingam pass at all. What is
visible at maximum zoom is the resolution of the source data.

## The measurement

Over `dist/versions.2.json` on the real pinned build — 3,422,830 vertices
across 109,923 rings — the distance between consecutive vertices is:

| percentile | projected units | km |
|---|---|---|
| p25 | 0.002190 | 16.2 |
| p50 | 0.003879 | 28.7 |
| p75 | 0.006432 | 47.6 |
| p95 | 0.013322 | 98.6 |

(1 projected unit is about 7,403 km, taking the projected world width of
5.41326 units against a 40,075 km equatorial circumference. Equal Earth is
equal-area, so this converts area faithfully and length only approximately —
good enough to reason about resolution, not a distance measurement.)

Against a 1400 px viewport, that median segment covers:

| zoom | km across the viewport | median segment |
|---|---|---|
| 1x (fit) | 40,075 | 1.0 px |
| 8x | 5,009 | 8.1 px |
| 16x | 2,505 | 16.1 px |
| 32x | 1,252 | 32.1 px |
| 64x | 626 | 64.2 px |

At the old 64x ceiling a typical border segment spans 64 screen pixels. At
that point the map is not showing a coastline; it is showing the straight
lines between the points someone digitised, at a magnification that presents
them as if they were coastline.

## Decision

`MAX_ZOOM_FACTOR` is **16**.

The binding rule is `CLAUDE.md`'s **never dramatise what the data cannot
support**, which until now had been applied to time (the expansion flash is
suppressed across long sampling gaps) but not to space. A zoom ceiling is
the spatial form of the same rule: magnifying past the data's resolution
makes a confident-looking claim about where a border ran that the data does
not make.

16 was chosen by the owner from 8x / 16x / 24x / 32x / 64x, compared live on
the real map. The arithmetic bounds the sensible range and the judgement
picks within it: 16.1 px per median segment is visible as geometry if you
look for it, but the map still reads as a map, and 16x still gets you from
the whole world to about 2,500 km across — enough to look at one region
properly, which is what zoom was added for.

## Rejected alternatives

**1. Keeping 64x.** Rejected on the measurement above: it presents 64 px of
straight line as coastline. Nothing about the artifact pipeline can improve
this, because full is already unsimplified — the only fix would be better
source data.

**2. Dropping to 8x**, where the median segment is 8.1 px and faceting is
genuinely hard to see. Rejected as over-correction: it costs half the useful
zoom range to remove an artefact that at 16x is visible only on inspection,
and 5,000 km across the viewport is too coarse to examine a single polity's
borders. The honest bound is not "no visible vertices" but "no claim the data
cannot support", and at 16x a viewer can still see that the borders are
polygonal rather than being misled into reading them as surveyed.

**3. Varying the ceiling by detail level**, so full permits more zoom than
coarse. Rejected because it reintroduces exactly what Milestone 2 measured
and dropped: levels differ in vertex *count*, not in vertex *spacing* — the
retained-vertex spacing measurement found at most 35% difference with
identical maxima, and coarse's median segment is 38.7 km against full's 28.7,
a factor of 1.35. A per-level ceiling would imply a fidelity difference that
does not exist. See `docs/phase-2-milestone-2-design.md`, "Thresholds: what
the measurement actually showed".

## Consequences

- The wheel now crosses the full zoom range in about 7 notches rather than
  10, at the sensitivity set in `wheelZoomFactor`. That interacts with the
  ceiling but was tuned separately and is not changed here.
- 0020's maximum-zoom figures are restated: max zoom is 4138.0 px/unit rather
  than 16551.9, and the p99 displacement there is 12.13 px rather than 48.5.
  0020's argument against phrasing its criterion at maximum zoom is unchanged
  — a criterion that both real candidates fail by 12x, and that only the
  unsimplified reference can pass, still discriminates nothing.
- The temporary chrome control used to compare the candidates is removed. It
  existed only for this decision.
- **What would change this answer:** source geometry with finer border
  resolution. This ceiling is a property of Cliopatria's digitisation, not of
  the viewer, the projection or the pipeline. If a future dataset's median
  segment drops, re-take the measurement above and raise the ceiling to
  match — the command is a walk over `dist/versions.2.json` computing the
  distance between consecutive vertices, and the number to watch is the
  median segment in screen pixels at the ceiling under consideration.
