# 0013 - The change index buckets polygons, not versions

**Status:** accepted

## Context

`changes.json` backs decision 0006's viewport-scoped "when does this view next
change": given a bbox and a year, find the next year in which anything visible
starts or ends. The obvious unit to index is a `Version` - `VersionGeometry`
already stores one `bbox` per version, computed once at emit time.

That bbox is the union across every polygon a version has, and some polities
are scattered or transcontinental. Measured on the real dataset, indexing by
version bbox puts one version's box in 1,479 of 2,048 grid cells - 72% of the
map. A query anywhere near that scale would surface that version's change
years regardless of whether any of its actual polygons are on screen.

## Decision

The index buckets each **polygon** by its own bounding box instead of using
the version's combined one. On the same dataset the worst single polygon
claims 207 cells (10%), against the version-level 72%. Index entries fall
from 1,682,966 to 471,954, about 70% smaller, purely as a side effect of not
over-claiming cells - the index was never bytes-constrained: after
deduplication the artifact is 33 KB gzipped at the chosen 64x32 grid, so grid
resolution was picked for query precision, not size.

## Consequences

- A polygon's bounding box is still not the polygon. A query can still report
  a change for something just off-screen, in the box's corner rather than the
  shape itself. This is accepted, not fixed: the failure mode shows a change
  that turns out to be slightly out of view rather than silently skipping a
  real one, and the latter is the failure this project will not make.
- Building the index means iterating every polygon in every version rather
  than reading one bbox off `VersionGeometry`, which is more work at build
  time in exchange for a materially tighter index.

## Correction (Milestone 2, Task 2): which YEARS a cell buckets

This decision is about which polygon a cell buckets against; it says nothing
about which year. The original implementation bucketed each version's
`fromYear` and `toYear` directly, and that part was wrong independent of the
polygon-vs-version question above.

A version stops being drawn at `toYear + 1`, not `toYear` - the fade-out
begins the year after the claim ends (see the fade-out logic in
`packages/viewer`). Bucketing `toYear` records a year at which nothing
happens, and misses the year at which something does. It also makes one
transition look like two events a year apart: when version A of a polity ends
at 1200 and version B begins at 1201, bucketing `toYear` records both 1200 and
1201 for what is really one moment of change. On the real dataset this put
937 distinct years in the index where only 509 real transition moments exist.

Milestone 1 sidestepped this entirely by deriving event years from version
rows directly (`fromYear` and `toYear + 1`, see
`packages/viewer/src/engine/change-years.ts`) rather than from the index -
exact only because with no zoom the viewport is the world and a brute-force
scan over all rows is affordable. Viewport-scoped playback cannot do that; it
needs the index itself to be correct.

The fix buckets `fromYear` and `toYear + 1` instead of `fromYear` and
`toYear`, in both `buildChangeIndex` and its independent oracle
`nextChangeBruteForce` - the two must move together or the oracle stops
verifying anything.
