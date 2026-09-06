# 0012 - Antimeridian-crossing geometry is cut

**Status:** accepted

**This is the only place the pipeline splits geometry. Read it before changing
anything in `stages/antimeridian.ts`.**

## Context

GeoJSON writes a polygon crossing 180 degrees longitude as a jump: 170 followed
by -170. Projected naively into Equal Earth, that segment becomes a line across
the entire map, and the polygon fills as a stripe through every continent
between them. Zero Cliopatria rows are affected -- the maximum absolute
longitude in the pinned release is exactly 180, and a full build cuts none of
them -- but the artifact would be grossly wrong wherever a future release did
introduce one.

## Decision

Rings whose consecutive longitudes jump more than 180 degrees are unwrapped into
continuous longitudes, clipped into 360-degree bands, and shifted back -- all in
lon/lat space, before projection. Holes are moved into the outer ring's frame
first so they are not dropped. Polygons that do not wrap are returned untouched.

## Why this is not "inventing geometry"

The project's non-negotiable is never asserting what the data cannot support.
The cut line is a meridian at the map's edge, not a frontier: it carries no
claim about who held what. The alternative asserts something far stronger and
plainly false -- that a polity occupied a band across the whole world.

The distinction against clipping to a viewport bbox (deliberately not done, see
the Phase 0 spike's `extract.mjs`) is that a bbox edge cuts through the middle
of the map where a reader reads it as a border. The antimeridian is the seam the
projection already has.

## A pole seam is not a crossing

Natural Earth's Antarctica ring exposed a second shape that produces the same
longitude jump without being a crossing at all. A polar cap is written the
standard way: the ring runs along the continent's edge, reaches the pole at
one extreme longitude (`[180, -90]`), and steps to the other extreme
(`[-180, -90]`) before continuing. That step is 360 degrees of longitude by
the raw numbers, but zero distance on the globe -- every line of longitude
converges to the same point at a pole, so `[180, -90]` and `[-180, -90]` are
the same spot. Treating it as a crossing unwrapped the ring, split it across
two 360-degree bands, and let Sutherland-Hodgman close each piece with a
fabricated edge along a parallel -- exactly the invented geometry this
decision exists to prevent, measured at just under 1% of world land area
before it was caught.

The fix distinguishes the two cases on the endpoints, not just the jump size:
a step of more than 180 degrees only counts as a crossing when at least one
endpoint is off the pole (`|lat| !== 90`). A ring with both endpoints on the
same pole is left untouched; its seam projects to the correct horizontal edge
along the top or bottom of the map. See `ringWraps` in
`packages/pipeline/src/stages/antimeridian.ts` and the polar-cap regression
test in `packages/pipeline/tests/antimeridian.test.ts`.

## Consequences

- One polity becomes several polygons in the artifact. Nothing downstream cares:
  geometry is already a list of polygons per version.
- Sutherland-Hodgman can leave zero-area spurs along the cut line on concave
  rings. They sit exactly on the antimeridian and are invisible under any fill
  rule. Accepted rather than adding a general polygon clipper.
- The build reports how many polygons were cut. A sudden change in that count on
  an upstream bump means the source's geometry conventions changed.
- The acceptance criterion "no polygon crosses the antimeridian in projected
  space" is what stops this silently regressing.
