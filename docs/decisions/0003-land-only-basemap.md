# 0003 — Land and sea only, from Natural Earth

**Status:** accepted, reversed from an earlier position

## Context

The first position was no basemap at all, on the grounds that overlaying ancient
vectors on modern coastlines is misleading — shorelines, rivers and lakes move
over millennia. That was half right. Without any coastline the map is abstract
shapes in a void, with no way to tell where the sea starts or where coverage
runs out.

## Decision

Natural Earth land polygons, public domain, projected into the same Equal Earth
space at build time. Three ground tones and nothing else:

| Tone | Meaning |
|---|---|
| sea | recessive |
| unclaimed land | quiet, but never confusable with sea |
| territory | the only saturated thing on screen |

No rivers, no lakes, no modern borders, no labels.

## Consequences

The middle tone is also the coverage diagnostic. A year where the plate is
mostly bare land is a year the dataset is thin, visible at a glance, with no
separate overlay needed.

The coastline is modern. That is defensible across this project's range almost
everywhere, but the UI states it once rather than hiding it. Known exceptions
worth naming: the Aral Sea, the Dutch coast, the head of the Persian Gulf.

Natural Earth is public domain, so it adds no licensing constraint on top of
Cliopatria's CC-BY.
