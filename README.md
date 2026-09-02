# Playback spike

Phase 0. The job of this code is to answer one question: what does "time flowing
smoothly" mean to you, concretely enough to design a schema against.

**This code is disposable.** It has no build step, no dependencies, and no
abstractions worth keeping. Do not let it become the foundation. The thing you
keep at the end of this phase is a one-page decision, not a repo.

## Setup

### 1. Get Cliopatria

Download `cliopatria.geojson.zip` from the
[GitHub releases](https://github.com/Seshat-Global-History-Databank/cliopatria/releases)
or [Zenodo](https://zenodo.org/records/13363121), and unzip it to
`data/cliopatria.geojson`.

Licence is Creative Commons Attribution. Check `LICENSE.md` in that repo and keep
the attribution in whatever you eventually ship.

If you want to try the tooling before downloading anything, generate a fake file
with the right schema:

```bash
node scripts/make-fixture.mjs
```

### 2. Look at the data before rendering it

```bash
node --max-old-space-size=8192 scripts/histogram.mjs --era=classical --bucket=50
```

This prints, per time bucket, how many **distinct years anything changes**. Not
how many polities exist. The distinction is the whole point: rows on screen
measure how full the map looks, distinct change years measure how often it
changes, and only the second one produces the feeling of time passing.

Run it across all regions first with no `--region` flag. You are looking for
which regions have near-flat bars, because that is where playback will feel dead
no matter which mode you pick.

### 3. Extract the slices

```bash
node --max-old-space-size=8192 scripts/extract.mjs \
  --region=mediterranean --era=classical --out=data/slice.json

node --max-old-space-size=8192 scripts/extract.mjs \
  --region=subsaharan --era=classical --out=data/slice-control.json
```

The second one is the control, and it matters. The Mediterranean between 200 BCE
and 500 CE is the best-covered region in the dataset, because Cliopatria was
built from historical atlas images and atlas-makers have always concentrated
there. Anything that only works on the Mediterranean is a demo, not a finding.

### 4. Get the basemap

Download Natural Earth land polygons as GeoJSON from the natural-earth-vector
repo. Natural Earth is public domain, so it adds no licensing constraint on top
of Cliopatria's CC-BY.

```bash
# 50m is the better fit for a regional view like the Mediterranean.
# Use 110m for a whole-globe view.
node scripts/basemap.mjs --input=data/ne_50m_land.geojson --out=data/land.json
```

The app runs without it, and says so in the sidebar. The coastline is modern;
over this project's range that is defensible almost everywhere, with real
exceptions worth naming rather than hiding: the Aral Sea, the Dutch coast, and
the head of the Persian Gulf.

### 5. Simplify (optional for the spike, required later)

If the raw geometry is heavy, run it through
[mapshaper](https://github.com/mbloch/mapshaper) before extracting:

```bash
npm install -g mapshaper

mapshaper data/cliopatria.geojson \
  -simplify visvalingam weighted 5% keep-shapes \
  -o data/cliopatria-simplified.geojson
```

`keep-shapes` stops small polities vanishing entirely. Do not use per-polygon
simplification: mapshaper preserves shared topology by default, and without that
neighbouring borders crack apart into hairline gaps that look exactly like
rendering bugs.

Mapshaper is also the fallback if `extract.mjs` runs out of heap on the full
file. Pre-filter on disk first:

```bash
mapshaper data/cliopatria.geojson \
  -filter 'Type === "POLITY" && FromYear < 500 && ToYear > -200' \
  -o data/cliopatria-classical.geojson
```

### 6. Run it

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Serve it over http rather than opening
`index.html` directly, or the module imports and the `fetch` will both be blocked
by the file:// origin rules.

Load the control slice with `?slice=data/slice-control.json`.

## Controls

Speed is the only knob, deliberately. The fade is derived from it:

```
fadeYears = clamp(0.7s x speed, 1.5, medianVersionDuration / 6)
```

Constant wall-clock fade keeps the feel identical across speeds, but pure
proportionality breaks at the top end, where the fade window grows until three
states of one polity overlap. `extract.mjs` prints the suggested ceiling from
the real median duration.

The slider is logarithmic, 1 to 200 yr/s, defaulting to 4. The interesting range
is 1 to 20, and a linear slider would bury all of it in the first tenth of travel.

- **Space** toggles playback.
- **Hover** a territory for its name and validity interval.
- **Click** a territory to open its Wikipedia article.
- The tick track above the scrubber marks every year in which anything starts or
  ends. Clumps are where the source atlases were dense.
- In the sidebar, a clay dot marks a territory currently flashing an expansion,
  a grey dot marks one that has contracted.

## The expansion flash

Growth brightens a territory as it fades in. Contraction just fades. But the
brightness is suppressed in two cases, because it would otherwise claim an event
the data cannot support:

- **First appearance.** Often the atlas starting to cover a region, not a polity
  coming into being.
- **A gap longer than 50 years since the previous version.** That represents
  accumulated drift across a hole in the sampling, not a datable event.

Strength scales with *relative* area change, so a small polity doubling reads as
strongly as an empire gaining a few percent. Full strength at +50%.

You will see the flash go quiet in exactly the regions where coverage is
weakest. That is the intended behaviour, not a bug.

## What is deliberately not here

- **No morph mode.** Polygon interpolation invents geometry that never existed,
  which is the exact failure this project is trying to avoid, and it breaks on
  multipolygons and topology changes, which is most of this data.
- **No modern basemap.** Land and sea only, no rivers, no lakes, no present-day
  borders, no labels. The land tone doubles as the "no data here" state, so
  thin coverage is visible at a glance without a separate overlay.
- **No clipping to the bounding box.** Clipping would draw borders that never
  existed. Polygons extending past the viewport are simply cropped at draw time.
- **No Web Mercator.** Territorial extent is an area story, and Mercator inflates
  high latitudes. Geometry is pre-projected to Equal Earth at build time, which
  also means no map library is needed at all.
- **RELATION rows are dropped.** They encode composite and membership structure
  rather than plain territory. How to render them is a Phase 3 question, and
  answering it now would contaminate the thing you are trying to judge.

## Done criteria

Write one page answering three things:

1. Which mode, and why.
2. What speed and transition duration felt right, and whether duration should be
   fixed in wall-clock time or proportional to the gap in the data.
3. **How many distinct change years per century the chosen mode needs before it
   stops feeling alive.**

The third is the one that matters. It is the requirement the real schema gets
designed against, and the number that tells you where hand-authoring work would
actually buy you something.

## Files

```
scripts/make-fixture.mjs   Fake Cliopatria-shaped data. Delete once you have the real file.
scripts/histogram.mjs      Change-density analysis. Run this first.
scripts/extract.mjs        Filter, project, derive lineage, emit a render-ready slice.
scripts/basemap.mjs        Project Natural Earth land into the same space.
src/lib/regions.mjs        Region bboxes and era bounds.
src/lib/geojson.mjs        Reading, bbox and interval helpers.
src/lib/projection.mjs     Equal Earth, and the viewport fit.
src/lib/temporal.mjs       Crossfade alpha, speed-derived fade, flash attribution.
src/lib/palette.mjs        Chalky pastels, ground tones, the flash ramp.
src/lib/render.mjs         Canvas loop over prebuilt Path2D geometry.
src/app.mjs                Clock, controls, readouts.
index.html                 Chrome.
```

## Attribution

Cliopatria, Seshat Global History Databank. Turchin et al. CC-BY.
<https://doi.org/10.5281/zenodo.13363121>

Natural Earth. Public domain, no attribution required.
<https://www.naturalearthdata.com/>
