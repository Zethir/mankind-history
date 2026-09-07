# @history/viewer

The viewer: loads the coarse build artifacts, plays territorial history back
on a canvas, and provides the chrome (play/pause, scrub, speed) around it.
Depends on `@history/model` for types and the Equal Earth helpers, and on the
staged data described below. Never depends on `packages/pipeline` (decision
0009) - the boundary between build and viewer is the whole point of Phase 1.

## Running it

```bash
pnpm install
pnpm dev                          # from the repo root, or:
pnpm --filter @history/viewer dev
```

`predev` and `prebuild` run `scripts/stage-data.mjs`, which copies
`polities.json`, `versions.0.json` and `land.0.json` into `public-data/` -
Vite's `publicDir` - preferring the repo's real `dist/` (from `pnpm build` at
the root) and falling back to the committed `fixtures/dist/` so a fresh
clone can run before anything is fetched or built. `vite.config.ts` never
points `publicDir` at `dist/` directly: `dist/` also carries `versions.1.json`
and `versions.2.json`, 154 MB together, which this milestone never requests.

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
              and flash. Pure computation - no HTMLElement, no document,
              no window, no canvas.
src/render/   MapRenderer: turns one engine Frame into Path2D calls on a
              CanvasRenderingContext2D. Reads the engine's output; never
              reaches back into it.
src/ui/       Chrome: the DOM controls (play, scrub, speed buttons) and
              the year readout. Drives the engine (play/pause, seek,
              speed) and reads Frame back to update itself - never keeps
              its own copy of playback state.
src/data/     fetchArtifacts: loads and schema-checks the three artifacts
              the engine and renderer need.
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

- The coarse level's worst frame in the whole dataset (year 2014) draws 195
  active versions and 19,729 vertices. See decision 0015.
- `fitWorld` in `src/render/transform.ts` measures the real
  pixels-per-projected-unit figure for whatever canvas size it is given: at
  1400x900 that is 258.6 px per projected unit, the number Milestone 2 uses
  to replace the provisional `PX_PER_UNIT` constants in
  `packages/model/src/canon.ts`.

Neither figure is a judgement on whether the playback feel or the palette
hold up - that is Milestone 1's outstanding exit condition, decided by a
human watching the map, not by this package's tests.
