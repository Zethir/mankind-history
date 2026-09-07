# 0015 - No render caching beyond prebuilt paths

**Status:** accepted

## Context

A canvas renderer redrawing an animated scene every frame usually grows layer
caching, dirty rectangles or tiling to avoid repeating work across frames. The
coarse artifact holds 2,400,206 vertices across its 13,380 rows, which sounds
like exactly the kind of dataset that needs some of that.

## Decision

None of it. `MapRenderer` clears and redraws the full canvas every frame:
`fillRect` for the sea, the one land `Path2D`, then every active version's
`Path2D`, built lazily on first use and kept for the geometry's lifetime.
Finding the active set is a linear scan of all 13,380 rows, done once per
frame by the engine layer this renderer consumes; the renderer adds no index
of its own.

## Why

A year is a thin slice of a 5,424-year span. Measured across the whole
timeline: median 35 active versions and 1,548 on-screen vertices, p95 147
versions and 16,066 vertices, worst year (2014) 195 versions and 19,729
vertices. Even the worst frame ever drawn stays under 20,000 vertices, two
orders of magnitude below the artifact's total. There is no per-frame cost
here for caching to save.

## Consequences

- The renderer stays simple enough to read and reason about as a whole: one
  pass, no cache invalidation logic, no dirty-rectangle bookkeeping to get
  wrong.
- The active-set query behaves identically under playback, scrubbing and
  jumping, because there is no cursor or incremental state to invalidate on a
  seek.
- If profiling later contradicts this, the fix is to re-take the measurement
  first, not to add caching on suspicion -- the measured worst case is the
  thing that would have to have changed.
- These figures are for the **coarse** level only, on this dataset. Milestone
  2's mid and full levels carry far more geometry per version and are a
  different question this record does not answer.
