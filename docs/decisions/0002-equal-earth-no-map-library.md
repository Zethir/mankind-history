# 0002 — Equal Earth, pre-projected, no map library

**Status:** accepted

## Context

Territorial extent is an area story. Web Mercator inflates high latitudes
severely, making Russia and Canada read as continents. Every mainstream mapping
stack is Mercator-locked in flat mode.

Separately, a 3D globe was considered and rejected: the experience depends on
seeing simultaneous change across the world, and a globe hides half of it.

## Decision

Flat map on the Equal Earth projection. Geometry is projected at build time and
shipped in projected coordinates. Rendering is canvas 2D over prebuilt `Path2D`
objects; pan and zoom are a canvas transform.

No map library, no tile server, no runtime projection.

## Consequences

- Verified equal-area: a 2°×2° box at latitude 60–62 projects to 0.4849 of the
  same box at the equator; cos(61°) = 0.4848.
- The dataset is small enough to ship whole, so v1 needs no backend at all.
- Zoom needs multiple simplification levels, since one geometry resolution
  cannot serve both a global and a regional view.
- Equal Earth is a global pseudocylindrical projection. For a purely regional
  product an Albers conic would fit better; global consistency won.
