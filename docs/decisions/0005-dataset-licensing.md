# 0005 — Dataset licensing

**Status:** accepted. Revised — an earlier version of this record wrongly stated
that historical-basemaps declared no licence. It is GPL-3.0.

## Context

Public open-source release is the goal, which makes licensing structural rather
than paperwork. A dataset that cannot be redistributed poisons the entire build
output, and a copyleft dataset dictates the licence of everything it touches.

## Decision

| Dataset | Licence | Status |
|---|---|---|
| Cliopatria (Seshat) | CC-BY | **Primary source.** Attribution ships in the build output and in the UI. |
| Natural Earth | Public domain | **Basemap.** No attribution required; given anyway. |
| historical-basemaps | GPL-3.0 | **Available, deferred.** See 0008 for why it is not the spine, and below for the cost of adopting it. |
| CShapes 2.0 | CC BY-NC-SA 4.0 | **Ruled out.** Non-commercial, and share-alike is viral. |

Code licence is therefore a free choice *today*, and becomes constrained the day
historical-basemaps is adopted.

## On historical-basemaps and GPL-3.0

Two separable points.

It is a software licence applied to a dataset. GPL-3.0 is written in terms of
source code, object code and "the Program"; what it means for GeoJSON is
genuinely unclear, and maintainers frequently select it from a dropdown without
considering data specifically. Nobody here is a lawyer. Take it at face value
anyway — assuming the weaker reading in your favour is not a position worth
defending later.

At face value it is strong copyleft. Incorporating the data makes this project a
derived work, so this project becomes GPL-3.0. For a web app that reaches the
viewer too: copyleft triggers on distribution, and shipping JS and data to a
browser is distribution.

Combining it with Cliopatria's CC-BY appears workable, since CC BY 4.0 permits
adapted material under different terms provided attribution survives.

For a project actively seeking contribution, copyleft is arguably aligned rather
than a cost. It mainly deters proprietary forks.

## Consequences

- Ruling out CShapes costs precision from 1886 onward. Accepted.
- `confidence` stays in the schema and unpopulated until historical-basemaps is
  adopted, since `BORDERPRECISION` is the only licensed source for it. The UI
  carries an honest line instead: borders are approximate, and historical
  territory frequently had no precise frontier at all.
- **Do not adopt historical-basemaps casually.** The blocker is no longer the
  licence, it is the join (0008) and the copyleft consequence above. Adopting it
  is a deliberate decision with a licence change attached, not an incremental
  data addition.
