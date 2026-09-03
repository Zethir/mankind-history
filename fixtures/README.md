# Fixtures

A deterministic carve of the real, pinned upstream data. Committed so tests and
a first run work without a 46 MB download (165 MB once unpacked).

Regenerate with `pnpm extract-fixture` after `pnpm fetch:sources`. Regeneration
is a deliberate act -- it happens when an upstream pin changes, and the diff is
reviewed.

## Selection

By vertex, never by bounding box: a polygon crossing the antimeridian has a
lon/lat bounding box spanning the whole world, so a bbox test would pull every
wrapping polygon into every slice. `selectFeatures` (in
`packages/pipeline/src/stages/extract-fixture.ts`) keeps a feature whenever any
one of its vertices falls inside `FIXTURE_BBOX`, a small box around the city
of Rome (`[12.2, 41.6, 12.9, 42.1]`).

This carving is applied to `cliopatria_polities_only.geojson` and
`ne_50m_land.geojson`. `ne_110m_land.geojson` is the one exception: it is
copied through whole, unfiltered -- see "Why the coarse land layer is not
carved" below.

A selected feature is kept whole, un-clipped: no polygon is cut to fit the
box. Cutting geometry to a selection window would draw a border edge that
never existed upstream, which is exactly what `docs/decisions/` and
`CLAUDE.md` rule out ("never invent geometry"). This is also why the box has
to be so small: one vertex inside it pulls in a polity's entire multi-century
extent, so the size of the slice depends on how many *other* entities happen
to have a vertex somewhere in the box, not on the box's own area.

`Type` is deliberately not filtered: `RELATION` rows are kept so the normalise
stage's `POLITY` filter has something real to drop (8 `RELATION` rows survive
the carve).

### Why the box is Rome, not "Italy" or "the central Mediterranean"

Wider boxes were tried first and measured directly against the pinned
release:

| box | area | raw `.geojson` |
|---|---|---|
| `[5, 34, 30, 47]` (central Mediterranean) | Italy, Greece, the Adriatic, the African coast | 76 MB |
| `[8, 36, 19, 47]` (Italy alone) | the Italian peninsula, Sicily, Sardinia | 69 MB |
| `[11.0, 41.6, 14.0, 43.5]` (central Italy, no Naples) | Rome, Tuscany, Umbria, the Abruzzo coast | 19 MB |
| `[12.2, 41.6, 12.9, 42.1]` (Rome) | the city and its immediate surroundings | 1.0 MB (see below) |

Every box wider than the Rome box touches the Spanish Empire, the Holy Roman
Empire, the Ottoman Empire and similar continent-spanning polities at some
point across 3000+ years of Italian history; each is a several-thousand-vertex
shape repeated across dozens of yearly rows, and whole-feature selection keeps
every one of them entire. The Rome box still lands on real, dense lineage --
Roman Kingdom, Roman Republic, (Western) Roman Empire, Ostrogothic Kingdom,
Papal States, Kingdom of Italy, Nazi-occupied Italy, Republic of Italy -- 11
chains of two or more versions, 45 of its 55 features are multipolygons, and
8 `RELATION` rows survive for the filter to drop, all at roughly 1/70th the
size of the Italy-alone box.

### Why the coarse land layer is not carved

`ne_110m_land.geojson` (127 features, 138 KB upstream) is committed whole,
unfiltered, rather than carved to `FIXTURE_BBOX` like everything else. Two
things are true of it that are not true of the Cliopatria data or of the
50m coastline:

- **It is small.** The whole file is 138 KB and projects to a 70 KB
  artifact. Shipping it entire costs about 200 KB total, which is cheap next
  to what it buys.
- **It is global by nature, not regional.** The 110m layer is what a global
  view of the map needs -- the whole world's coastline at low detail -- so a
  regional carve of it is not a smaller version of the same thing, it is a
  different, wrong thing: a coarse layer that only exists near Rome.

Carving it anyway used to leave `land.0.json` an empty polygon list, because
the 110m simplification has no vertex inside a box this small. An empty
golden artifact cannot fail: if the land pipeline broke outright, the
artifact would still be an empty list and nothing would look wrong. Shipping
the layer whole fixes that -- `land.0.json` is now a real 128-polygon
artifact that a broken coarse-land build would visibly diverge from.

The 50m layer stays carved. It is detailed and regional by nature -- the
whole point of a fine layer is local detail, not the whole world at fine
detail -- and its full source is 1.6 MB, big enough that shipping it whole
is not a reasonable default. Its current carve already yields a non-empty
234 KB slice, so it does not have the coarse layer's problem.

Widening `FIXTURE_BBOX` to force the 50m carve (or a re-carved 110m layer)
to have more coverage was considered and rejected: selection is
whole-feature, so a wider box does not add proportionally more land, it
starts pulling in whichever multi-century political entities happen to have
a vertex in the wider area too -- exactly the cost that keeps `FIXTURE_BBOX`
this small in the first place, described above.

### There is no antimeridian selector

An earlier version of this fixture also kept any feature with a vertex within
10 degrees of longitude 180, reasoning that antimeridian-adjacent geometry was
worth having on hand. Measured against the real, pinned Cliopatria release,
that reasoning does not hold:

- **No polygon in the pinned release crosses the antimeridian at all.** The
  maximum absolute longitude in the whole dataset is exactly 180, and a full
  `pnpm build` run of the real data cuts zero polygons. A selector built to
  capture wrapping geometry therefore has no real wrapping geometry to
  capture, in this fixture or in the full dataset.
- **It was expensive for that reason.** The one polity whose territory
  reaches exactly longitude 180 across most of its documented history is
  Russia; whole-feature selection means any threshold close enough to 180 to
  mean anything pulls in the *entire* un-clipped, multi-century Tsardom /
  Empire / Republic / USSR / Federation lineage -- around 10 MB -- to
  exercise a code path that, on this data, does nothing.

The antimeridian-cutting code path is exercised on its own terms by the ten
synthetic-ring tests in `packages/pipeline/tests/antimeridian.test.ts`, which
is the honest place for it: geometry built specifically to cross the
antimeridian, rather than real geometry hoped to.

**If a future upstream release introduces real wrapping geometry**,
reinstate a selector here: add back an `ANTIMERIDIAN_LON` threshold constant
and OR a `Math.abs(lon) >= ANTIMERIDIAN_LON` check into the vertex predicate
in `selectFeatures` (git history on this file has the prior implementation
and its size measurements), then re-run `pnpm extract-fixture` and
`pnpm fixture:bless` and check the resulting size before committing.

## Sizes (measured on this pinned release)

```
fixtures/cliopatria_polities_only.geojson   1.01 MB  (55 features: 47 POLITY, 8 RELATION, carved)
fixtures/ne_110m_land.geojson               135 KB   (127 features: all of them, copied whole)
fixtures/ne_50m_land.geojson                229 KB   (1 feature, carved)
fixtures/dist/versions.2.json               465 KB   (47 versions, full precision)
fixtures/dist/land.1.json                   154 KB   (1 polygon)
fixtures/dist/land.0.json                    69 KB   (128 polygons -- the whole world's coastline
                                                        at 110m resolution)
fixtures/dist/polities.json, manifest.json   <4 KB combined
```

Roughly 2.1 MB total across everything tracked under `fixtures/`, about
200 KB more than carving `ne_110m_land.geojson` too would cost. `land.0.json`
is now a real, non-empty golden artifact: shipping the whole 110m layer
means a broken coarse-land build has something to visibly diverge from,
where an empty-list artifact could not fail no matter how broken the
pipeline got. See "Why the coarse land layer is not carved" above.

## `dist/`

Golden build output for this slice. Regenerate with `pnpm fixture:bless`. An
unexplained diff here is a regression: the determinism acceptance criterion is
enforced by comparing a fresh build against these files.
