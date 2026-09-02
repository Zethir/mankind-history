# Data sources

Licence status for every source is in `docs/decisions/0005-dataset-licensing.md`.
Do not add a source without recording its licence there first.

## Cliopatria — primary territorial data

Seshat Global History Databank. CC-BY.
<https://github.com/Seshat-Global-History-Databank/cliopatria>
<https://doi.org/10.5281/zenodo.13363121>

Roughly 14,000 records covering 1,600+ political entities, 3400 BCE to 2024 CE.
Versioned MAJOR/MINOR/PATCH and mirrored to Zenodo.

Per-feature properties used: `Name`, `Type` (POLITY | RELATION), `FromYear`,
`ToYear` (integers, negative for BCE), `Area` (km², equal-area computed),
`Wikipedia`, `Wikidata`, `SeshatID`.

**Sampling is inherited, not uniform.** Cliopatria was built by converting
hand-coloured regions on historical atlas images into polygons, and the initial
release largely respected the source maps' own choice of spatial and temporal
resolution. Coverage therefore follows where atlas-makers concentrated: the
classical Mediterranean is the best-covered slice in the dataset, and treating
it as representative will mislead you. This is the single most important thing
to know about this data.

`RELATION` rows encode composite and membership structure rather than plain
territory. Currently filtered out. Rendering them is an open design question.

## Natural Earth — coastline

Public domain. <https://www.naturalearthdata.com/>

`ne_110m_land` for global views, `ne_50m_land` for regional. Land polygons only;
see decision 0003 for why nothing else from Natural Earth is used.

## historical-basemaps — deferred enrichment source

Andrei Ourednik. **GPL-3.0.**
<https://github.com/aourednik/historical-basemaps>

Not the spine, and the reasoning is in `docs/decisions/0008-snapshot-vs-interval.md`.
Snapshot model rather than intervals, so using it means inferring persistence
between sampled years.

What it has that Cliopatria does not:

- `BORDERPRECISION`, ordinal 1 (approximate), 2 (moderately precise),
  3 (determined by international law). The confidence signal this project wants
  for fuzzy border rendering. The repo ships a d3 example doing exactly that.
- `SUBJECTO`, the power actually exercising authority. Ideal for choropleth
  colouring by colonial power.
- `PARTOF`, cultural-area grouping.
- `places.geojson`, settlements with `inhabitedSince` / `inhabitedUntil`. A
  cities layer, if that is ever wanted.

Adopting it makes this project GPL-3.0 (0005) and requires a fuzzy name join
(0008). Both are real costs. Do not treat it as a drop-in addition.

Its README is worth reading regardless. The conceptual-limitations section makes
the same argument as decision 0003 about overlaying ancient vectors on modern
physical maps, and adds a sharper point: the concept of a national boundary only
becomes meaningful in Europe after Westphalia in 1648.

## Refreshing

Both sources are pinned by version in the build manifest. Bumping either is a
deliberate act: re-run the full pipeline, re-run acceptance checks, and diff the
change-year index, because a change in upstream sampling changes playback feel.
