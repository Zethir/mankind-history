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
