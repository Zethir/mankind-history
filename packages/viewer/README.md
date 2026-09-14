# @history/viewer

The viewer: loads the build artifacts, plays territorial history back on a
canvas with zoom and pan, and provides the chrome (play/pause, scrub, speed)
around it. Depends on `@history/model` for types and the Equal Earth helpers,
and on the staged data described below. Never depends on `packages/pipeline`
(decision 0009) - the boundary between build and viewer is the whole point of
Phase 1.

## Running it

```bash
pnpm install
pnpm dev                          # from the repo root, or:
pnpm --filter @history/viewer dev
```

`predev` and `prebuild` run `scripts/stage-data.mjs`, which copies all eight
of the pipeline's artifacts (`polities.json`, `versions.0/1/2.json`,
`land.0/1.json`, `changes.json`, `manifest.json`) into `public-data/` - Vite's
`publicDir` - preferring the repo's real `dist/` (from `pnpm build` at the
root) and falling back to the committed `fixtures/dist/` so a fresh clone can
run before anything is fetched or built. This used to be a curated subset of
four files, on the reasoning that the other four were bytes Milestone 1 never
requested; Milestone 2's progressive-upgrade chain and `changes.json` fetch
made that stale, and Task 9 found the staging script had not been updated,
so the deployed site was 404ing on `changes.json` and could never load past
coarse detail. See `docs/decisions/0021-artifacts-load-whole.md`. `dist/` is
154 MB uncompressed in total (`versions.2.json` alone is 77.0 MB - both
measured, see that record for the breakdown and how that differs from the
19.4 MB gzipped transfer figure), all of which is now staged and,
deliberately, not chunked.

```bash
pnpm --filter @history/viewer build   # writes dist-app/
```

The production build sets `base: "/mankind-history/"` because the site is
served from `https://<user>.github.io/mankind-history/`, a subpath rather
than a domain root - `index.html`'s asset links need the subpath prefix, or
they 404. `fetchArtifacts` (`src/data/artifacts.ts`) needs no equivalent
change: its default base is already relative (`"."`), which resolves
correctly under any subpath, and a leading slash there would break it.

## The engine / render / ui boundary

```
src/engine/   what year it is, which versions are active, at what alpha
              and flash, and (Milestone 2) what changes next within a
              viewport bbox (change-years.ts). Pure computation - no
              HTMLElement, no document, no window, no canvas.
src/render/   MapRenderer: turns one engine Frame into Path2D calls on a
              CanvasRenderingContext2D. Reads the engine's output; never
              reaches back into it. transform.ts holds the Viewport (zoom
              and pan as a centre plus a scale, applied via
              ctx.setTransform - decision 0002); level.ts names the three
              detail levels (DetailLevel).
src/ui/       Chrome: the DOM controls (play, scrub, speed buttons) and
              the year readout. Drives the engine (play/pause, seek,
              speed) and reads Frame back to update itself - never keeps
              its own copy of playback state.
src/data/     fetchArtifacts: loads and schema-checks the artifacts the
              engine and renderer need at startup. fetchVersions and
              fetchLand (artifacts.ts) fetch one detail level each for
              the progressive-upgrade chain; levels.ts's LevelRegistry
              tracks which levels have arrived and drives it (coarse
              resident from construction, mid requested after first
              paint, full once mid's fetch settles - see
              docs/architecture.md, "Zoom, progressive detail, and
              viewport-scoped playback").
```

**The engine imports no DOM.** Nothing under `src/engine/` may reference
`document`, `window`, `HTMLElement`, or any canvas type. This is a rule, not
a preference: `tests/engine.test.ts`, `tests/clock.test.ts`,
`tests/fade.test.ts` and `tests/flash.test.ts` exercise the whole of
playback - crossfade timing, flash suppression across sampling gaps,
adaptive speed - as plain function calls against numbers, with no browser
involved. Decisions 0001, 0004 and 0006 describe invariants this project
holds itself to; a DOM-free engine is what turns each one into a named test
instead of something a person has to notice by watching the map run. See
"The engine/renderer split" in `docs/architecture.md` for the full argument,
and decision 0015 for why the renderer does no caching beyond memoizing each
version's `Path2D`.

## Two measured figures

- The coarse level's two worst-frame maxima in the whole dataset fall in
  different years: the most active versions in one year is 195, in 2014
  (18,537 vertices there); the most on-screen vertices in one year is 19,729,
  in 1919 (90 versions there). See decision 0015.
- `fitWorld` in `src/render/transform.ts` measures the real
  pixels-per-projected-unit figure for whatever canvas size it is given: at
  1400x900 that is 258.6242 px per projected unit, recorded in
  `packages/model/src/canon.ts` as `DISPLACEMENT_REFERENCE_SCALE` - the
  reference scale the border-displacement acceptance criterion is measured
  at (decision 0020), not a value the renderer itself consults: the renderer
  reads `viewport.scale` continuously as the user zooms.

Neither figure is a judgement on whether the playback feel or the palette
hold up, and neither is a judgement on whether zoom and progressive detail
loading read as intended at a real zoom level - those are Milestone 1's and
Milestone 2's outstanding exit conditions respectively, decided by a human
watching the map, not by this package's tests.
