# 0008 — Cliopatria is the spine, not historical-basemaps

**Status:** accepted

**If you are wondering why the obvious dataset with 700+ stars is not the primary
source, this is the record.**

## Context

Two candidate territorial datasets, both open, both widely used.

| | historical-basemaps | Cliopatria |
|---|---|---|
| Time model | **Snapshots**: one GeoJSON per year | **Intervals**: every row carries FromYear/ToYear |
| Coverage | ~90 irregular year files | ~14K rows, 3400 BCE – 2024 CE |
| Identity | `NAME` string only | Wikidata + Wikipedia + SeshatID |
| Extras | `SUBJECTO`, `PARTOF`, `BORDERPRECISION` | `Area`, `Type` (POLITY / RELATION) |
| Provenance | Collected and adapted from diverse sources, some reachable only via the Wayback Machine | Digitised from a curated atlas image set, versioned, Zenodo DOI |
| Licence | GPL-3.0 | CC-BY |

## Decision

Cliopatria is the temporal spine. historical-basemaps is a candidate *enrichment*
source, deferred.

The deciding row is the first one.

historical-basemaps states the world in 1492 and the world in 1530. It says
nothing about 1500. Rendering 1500 requires inferring that 1492's borders
persisted — and that inference is ours, not the source's. Cliopatria instead
asserts "this polity held this shape from year X to year Y", which is a claim the
source itself makes and stands behind.

This is the same principle as refusing to morph geometry (0001), applied to the
time axis rather than the space axis. Every application built on
historical-basemaps interpolates in time. It is a defensible convention, but it
is a convention, and this project's one non-negotiable is not asserting what the
data does not support.

Cliopatria's schema is also, already, the temporal model this project needs.
Adopting it is not a compromise.

## Consequences

- Sampling density is inherited from the source atlas images and is therefore
  lumpy, heavily favouring the classical Mediterranean. Adaptive playback speed
  (0006) exists partly to absorb this.
- No `BORDERPRECISION` equivalent, so no confidence signal. See 0005.
- No `SUBJECTO`, so no colonial-power colouring. Colour is name-hashed instead.
- `RELATION` rows are currently dropped; rendering them is an open question.

## If historical-basemaps is adopted later

The cost is not the licence, it is the **join**. historical-basemaps identifies
polities by `NAME` string with no Wikidata ids, so merging means fuzzy name
matching across two datasets with different naming conventions *and* different
time models. That is a sub-project, and it belongs where it pays off: when fuzzy
border rendering is actually being built, not before.

The GPL-3.0 consequence (0005) is decided at that point, with real evidence about
how well the join works.
