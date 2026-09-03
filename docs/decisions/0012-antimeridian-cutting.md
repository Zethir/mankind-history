# 0012 - Antimeridian-crossing geometry is cut

**Status:** accepted

**This is the only place the pipeline splits geometry. Read it before changing
anything in `stages/antimeridian.ts`.**

## Context

GeoJSON writes a polygon crossing 180 degrees longitude as a jump: 170 followed
by -170. Projected naively into Equal Earth, that segment becomes a line across
the entire map, and the polygon fills as a stripe through every continent
between them. Only a handful of Cliopatria rows are affected, but the artifact
is grossly wrong wherever they are.

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
