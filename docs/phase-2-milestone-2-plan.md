# Phase 2 Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add zoom, pan, detail-level switching with prefetch, and viewport-scoped playback, so the map can be explored closely rather than only watched whole.

**Architecture:** The viewport becomes a centre plus a scale instead of a fixed fit. Paths move from screen space to world space so the canvas transform does pan and zoom, which is what decision 0002 always specified and what keeps the path cache alive. Detail level follows scale through measured thresholds, with mid prefetched after first paint and full after the first zoom. The engine gains a bounding box argument and answers "what changes here next" from the change index, which the pipeline must first fix.

**Tech Stack:** TypeScript (strict), canvas 2D, Vitest, pnpm workspaces. No new runtime dependencies.

**Spec:** `docs/phase-2-milestone-2-design.md` — read it first. It carries the measurements behind every constant and the reasoning behind two amended decisions.

## Global Constraints

- **Node 22** (`.nvmrc`). Run `nvm use` first; the shell may default to 20.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`. Every `array[i]` is `T | undefined`; existing code uses an `as T` cast after a bounds-guaranteed access — follow that.
- **Biome** with `--error-on-warnings`. 2-space indent, 100-column lines. `pnpm lint` must pass.
- **Vitest**, `packages/*/tests/**/*.test.ts`, `environment: "node"`. **Tests must not require a DOM and no DOM environment may be added.**
- **ASCII only** in TypeScript sources.
- **Nothing in `src/engine/` may import from `src/render/` or `src/ui/`, or touch `window`, `document` or `fetch`.** This milestone makes the engine spatially aware for the first time; it receives a bounding box as plain projected-unit numbers, never a viewport object and never a DOM event.
- **The viewer may import `@history/model`. It may NEVER import `@history/pipeline`.**
- Tests run against `fixtures/dist`, never `dist/`, so `pnpm test` needs no download.
- **Never assert something the data cannot support** (`docs/standards.md`).
- **Builds are deterministic**: same inputs, byte-identical outputs.
- Conventional commit prefixes, ending every message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Measurements already taken — do NOT re-derive

| level | gzipped | raw | JSON.parse | heap resident |
|---|---|---|---|---|
| coarse `versions.0` | 2.89 MB | 33.9 MB | 77 ms | 120 MB |
| mid `versions.1` | 4.47 MB | 45.0 MB | 88 ms | 151 MB |
| full `versions.2` | 12.05 MB | 73.5 MB | 149 ms | 219 MB |

All three resident: 331 MB. Fit-to-window scale: 258.6 px/unit at 1400x900, 354.7 at 1920x1080. Of 937 distinct change years, one cell holds 855 (91%). Coarse's and mid's worst-case displacements are the **same seven** world-space events (~0.0029 units).

---

## File structure

```
packages/model/src/
  grid.ts                   NEW  cellRangeFor, moved from pipeline
packages/pipeline/src/
  stages/change-index.ts    MOD  bucket toYear + 1
  stages/displacement.ts    NEW  percentile displacement measurement
  cli.ts                    MOD  `displacement` command
packages/viewer/src/
  render/transform.ts       MOD  centre + scale, zoomAt, panBy, clamp
  render/canvas.ts          MOD  world-space paths, ctx transform, scaled strokes
  render/level.ts           NEW  level selection with hysteresis
  data/artifacts.ts         MOD  per-level fetch
  data/levels.ts            NEW  prefetch policy and resident-level registry
  engine/change-years.ts    MOD  index-backed, bbox-scoped
  engine/engine.ts          MOD  accept a bbox
  ui/chrome.ts              MOD  wheel, drag, reset, level readout
  main.ts                   MOD  wiring
```

---

### Task 1: Measure displacement percentiles and set the thresholds

**Files:**
- Create: `packages/pipeline/src/stages/displacement.ts`
- Modify: `packages/pipeline/src/cli.ts`
- Test: `packages/pipeline/tests/displacement.test.ts`

**Interfaces:**
- Produces: `measureDisplacement(fullDir: string, level: "coarse" | "mid"): DisplacementReport` where `interface DisplacementReport { arcsConsidered: number; identical: number; droppedArcs: number; displacements: number[] }` — `displacements` in **projected units**, sorted ascending.

This task produces the numbers every later constant depends on. It is first because if the percentiles come back close together, the thresholds collapse and the milestone's shape changes.

- [ ] **Step 1: Read the existing measurement**

`packages/pipeline/tests/acceptance.test.ts` already builds shared arcs from full-detail geometry and measures per-arc Hausdorff displacement — search it for `directedHausdorff`. **Extract that logic into `stages/displacement.ts` rather than reimplementing it.** The test then imports from the stage instead of defining it inline, so there is one implementation rather than two that can drift.

Key properties of the existing method you must preserve: every full-detail edge is keyed direction-independently with the set of version ids using it; edges with two or more users are grouped by their exact co-user set and chained into maximal polylines; each side's simplified border is the retained subsequence of that arc's points; a side retaining fewer than two points has *dropped* the arc, which is a removal and is counted separately, not measured as displacement.

- [ ] **Step 2: Write the failing test**

`packages/pipeline/tests/displacement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { measureDisplacement } from "../src/stages/displacement";

const FIXTURES = "fixtures/dist";

describe("measureDisplacement", () => {
  it("reports arcs and displacements for the fixture at coarse", () => {
    const r = measureDisplacement(FIXTURES, "coarse");
    // The fixture is a thin slice -- 620 shared arcs against the full build's
    // 22,215 -- so this asserts shape, not statistics.
    expect(r.arcsConsidered).toBeGreaterThan(0);
    expect(r.identical + r.droppedArcs).toBeLessThanOrEqual(r.arcsConsidered);
    for (const d of r.displacements) expect(d).toBeGreaterThanOrEqual(0);
  });

  it("returns displacements sorted ascending, so percentiles are index lookups", () => {
    const r = measureDisplacement(FIXTURES, "coarse");
    for (let i = 1; i < r.displacements.length; i++) {
      expect(r.displacements[i] as number).toBeGreaterThanOrEqual(r.displacements[i - 1] as number);
    }
  });

  it("measures mid as a strictly less simplified level than coarse", () => {
    // Not a statistical claim about the fixture: mid retains 60% of vertices
    // against coarse's 30%, so it cannot drop MORE arcs than coarse does.
    const coarse = measureDisplacement(FIXTURES, "coarse");
    const mid = measureDisplacement(FIXTURES, "mid");
    expect(mid.droppedArcs).toBeLessThanOrEqual(coarse.droppedArcs);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run packages/pipeline/tests/displacement.test.ts`
Expected: FAIL — cannot resolve `../src/stages/displacement`.

- [ ] **Step 4: Implement by extraction**

Move the arc construction and Hausdorff code from `acceptance.test.ts` into `stages/displacement.ts`, exporting `measureDisplacement`. Then change `acceptance.test.ts` to import it. Its existing assertions must still pass unchanged — if they do not, the extraction changed behaviour and that is a bug in the extraction, not a reason to edit the assertions.

- [ ] **Step 5: Add the CLI command**

Add a `displacement` command to `packages/pipeline/src/cli.ts`, following the existing `histogram` command's shape, and a `"displacement"` script to the root `package.json`. It runs against `dist/` and prints, per level: arcs considered, identical, dropped, and the displacement distribution at p50, p90, p95, p99 and max, in **projected units and in pixels at the fit-to-window scale of 258.6**.

- [ ] **Step 6: Run it against the real build and record the numbers**

```bash
nvm use && pnpm build && pnpm displacement
```

Then, in `docs/phase-2-milestone-2-design.md`, replace the "Threshold viability check" proxy table with these real figures and state each level's threshold: **the scale at which that level's p99 displacement crosses one screen pixel**, i.e. `1 / p99_in_projected_units`.

**If the coarse and mid p99 figures come back within roughly 20% of each other, stop and report it rather than picking thresholds anyway.** That would mean level switching buys far less than the spec assumes, and the honest response is to say so.

- [ ] **Step 7: Measure the memory the spec left open**

The 331 MB figure covers parsed artifacts only. Measure `Path2D` construction, the proximity graph and the palette on top, and record the total in the design doc. Use `node --expose-gc`. This will not change the design unless it is wildly larger than expected, but the memory story is not settled until it exists.

- [ ] **Step 8: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/pipeline docs/phase-2-milestone-2-design.md package.json
git commit -m "feat(pipeline): measure per-arc displacement percentiles

Extracted from the acceptance test so there is one implementation rather
than two that can drift. Sets Milestone 2's level-switch thresholds.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix the change index to bucket `toYear + 1`

**Files:**
- Modify: `packages/pipeline/src/stages/change-index.ts`
- Modify: `docs/decisions/0013-index-buckets-polygons.md`
- Test: `packages/pipeline/tests/change-index.test.ts`

**Interfaces:**
- Produces: no signature change. `buildChangeIndex(versions, geometry, coordScale)` keeps its shape; only which years it buckets changes.

`changes.json` cannot answer the question viewport-scoped playback asks. It buckets `fromYear` and `toYear`, but a fade-out begins at `toYear + 1`, so the moment playback needs is unrecoverable. Milestone 1 sidestepped it by deriving event years from version rows, which is exact only because with no zoom the viewport is the world.

- [ ] **Step 1: Write the failing test**

Add to `packages/pipeline/tests/change-index.test.ts`:

```ts
it("buckets the year a fade-out begins, not the year the claim ends", () => {
  // A version ending at 1200 stops being drawn at 1201, so 1201 is the year
  // the view changes. Bucketing 1200 records a moment nothing happens at.
  const versions = [
    { ...baseVersion, id: "a@1100", polityId: "a", fromYear: 1100, toYear: 1200 },
  ];
  const geometry = { "a@1100": squareGeometry(0, 0) };
  const index = buildChangeIndex(versions, geometry, COORD_SCALE.coarse);
  const years = new Set(index.cells.flat());
  expect(years.has(1100)).toBe(true);
  expect(years.has(1201)).toBe(true);
  expect(years.has(1200)).toBe(false);
});

it("collapses adjacent transitions to one moment", () => {
  // Successive versions of one polity abut: a ends at 1200, b starts at 1201.
  // That is ONE transition, and both rows must agree it happens at 1201.
  const versions = [
    { ...baseVersion, id: "a@1100", polityId: "a", fromYear: 1100, toYear: 1200 },
    { ...baseVersion, id: "a@1201", polityId: "a", fromYear: 1201, toYear: 1300 },
  ];
  const geometry = { "a@1100": squareGeometry(0, 0), "a@1201": squareGeometry(0, 0) };
  const index = buildChangeIndex(versions, geometry, COORD_SCALE.coarse);
  const years = [...new Set(index.cells.flat())].sort((x, y) => x - y);
  expect(years).toEqual([1100, 1201, 1301]);
});
```

Reuse whatever `baseVersion` and `squareGeometry` helpers that file already has; if it has none, build them from `packages/model/src/types.ts`'s `Version` and `VersionGeometry`.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/pipeline/tests/change-index.test.ts`
Expected: FAIL — `1200` present, `1201` absent.

- [ ] **Step 3: Implement**

In `buildChangeIndex`, change the two bucketing lines from

```ts
cell.add(version.fromYear);
cell.add(version.toYear);
```

to

```ts
cell.add(version.fromYear);
// A fade-out begins the year AFTER the claim ends, so toYear + 1 is the
// moment the view changes. Bucketing toYear records a year nothing happens
// at, and makes a transition look like two events a year apart.
cell.add(version.toYear + 1);
```

- [ ] **Step 4: Re-bless the golden fixture and READ THE DIFF**

```bash
pnpm fixture:bless
git diff --stat fixtures/dist/
```

`changes.json` must change; the other seven artifacts must not. Confirm that before committing — a re-blessed golden nobody inspected is not a regression net.

- [ ] **Step 5: Verify against the real build**

```bash
pnpm build
node -e "
const c = require('./dist/changes.json');
const all = new Set(); for (const cell of c.cells) for (const y of cell) all.add(y);
console.log('distinct years in the index:', all.size);
"
```

Expected: **509**, down from 937. Quote the output in your report.

- [ ] **Step 6: Amend decision 0013**

Add a short section recording that the index originally bucketed `toYear`, that this recorded a year nothing happens at and made a single transition appear as two events a year apart, and that Milestone 1 worked around it by deriving event years from version rows. Do not rewrite the original decision — 0013's subject is bucketing polygons rather than versions, and that reasoning still stands.

- [ ] **Step 7: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/pipeline fixtures/dist docs/decisions/0013-index-buckets-polygons.md
git commit -m "fix(pipeline): bucket the year a fade-out begins, not the claim's end

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Move `cellRangeFor` into the model

**Files:**
- Create: `packages/model/src/grid.ts`
- Modify: `packages/model/src/index.ts`, `packages/pipeline/src/stages/change-index.ts`
- Test: `packages/model/tests/grid.test.ts`

**Interfaces:**
- Produces: `cellRangeFor(grid: ChangesArtifact["grid"], bbox: [number, number, number, number]): { x0: number; x1: number; y0: number; y1: number }`, exported from `@history/model`.

Mapping a bounding box to grid cells is part of interpreting the artifact, not building it, and the viewer may never import from the pipeline.

- [ ] **Step 1: Write the failing test**

`packages/model/tests/grid.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cellRangeFor, GRID, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "../src/index";

const grid = {
  cols: GRID.cols,
  rows: GRID.rows,
  bounds: [-WORLD_HALF_WIDTH, -WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH, WORLD_HALF_HEIGHT] as
    [number, number, number, number],
};

describe("cellRangeFor", () => {
  it("covers every cell for a bbox spanning the world", () => {
    const r = cellRangeFor(grid, grid.bounds);
    expect(r).toEqual({ x0: 0, x1: GRID.cols - 1, y0: 0, y1: GRID.rows - 1 });
  });

  it("clamps a bbox reaching outside the world instead of going negative", () => {
    const r = cellRangeFor(grid, [-99, -99, 99, 99]);
    expect(r).toEqual({ x0: 0, x1: GRID.cols - 1, y0: 0, y1: GRID.rows - 1 });
  });

  it("maps the origin to a middle cell, not a corner", () => {
    const r = cellRangeFor(grid, [0, 0, 0, 0]);
    expect(r.x0).toBe(GRID.cols / 2);
    expect(r.y0).toBe(GRID.rows / 2);
  });

  it("uses the grid it is given rather than the module constants", () => {
    // A released artifact keeps the grid it was built with. Reading GRID while
    // indexing the artifact's own cells would silently read the wrong cells the
    // moment the constant changes.
    const tiny = { cols: 4, rows: 2, bounds: grid.bounds };
    const r = cellRangeFor(tiny, grid.bounds);
    expect(r).toEqual({ x0: 0, x1: 3, y0: 0, y1: 1 });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/model/tests/grid.test.ts`
Expected: FAIL — `cellRangeFor` is not exported from the model.

- [ ] **Step 3: Move the function**

Cut `cellRangeFor` and its `clamp` helper from `packages/pipeline/src/stages/change-index.ts` into `packages/model/src/grid.ts`, keeping the existing doc comment verbatim — it explains why the grid is a parameter, which is the non-obvious part. Export it from `packages/model/src/index.ts`. Have the pipeline import it from `@history/model`.

- [ ] **Step 4: Note why acceptance criterion 12 needs no separate test**

Criterion 12 asks that the model's `cellRangeFor` map a bbox to the same cells the pipeline used when building the index. Because this task **moves** the function rather than reimplementing it, the pipeline calls the very same code -- they agree by construction, not by coincidence. Say so in your report. If you find yourself copying rather than moving it, stop: two implementations will drift, and the criterion exists precisely because that would silently read the wrong cells.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/model packages/pipeline
git commit -m "refactor(model): move cellRangeFor into the artifact contract

Interpreting the grid belongs with the contract, not the build. The viewer
needs it and may never import from the pipeline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Zoom and pan in the transform

**Files:**
- Modify: `packages/viewer/src/render/transform.ts`
- Test: `packages/viewer/tests/transform.test.ts` (new file; existing transform tests live in `render.test.ts` and stay there)

**Interfaces:**
- Produces:
  - `interface Viewport { width: number; height: number; scale: number; centreX: number; centreY: number }` — `centreX`/`centreY` in **projected units**, `scale` in **screen pixels per projected unit**.
  - `fitScale(width: number, height: number): number`
  - `fitWorld(width: number, height: number): Viewport`
  - `zoomAt(v: Viewport, factor: number, screenX: number, screenY: number): Viewport`
  - `panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport`
  - `toScreen(v, x, y, coordScale): [number, number]` and `fromScreen(v, sx, sy, coordScale): [number, number]` — unchanged signatures, updated to honour the centre.
  - `MAX_ZOOM_FACTOR: number` — how far past fit zoom may go.

`Viewport` currently has `offsetX`/`offsetY`. Those are replaced by `centreX`/`centreY`; every consumer must be updated.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/transform.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COORD_SCALE, WORLD_HALF_WIDTH } from "@history/model";
import {
  fitScale, fitWorld, fromScreen, MAX_ZOOM_FACTOR, panBy, toScreen, zoomAt,
} from "../src/render/transform";

const S = COORD_SCALE.coarse;

describe("zoomAt", () => {
  // Acceptance criterion 1. This is the property that makes zoom feel
  // controlled rather than lurching, and it drifts silently when the centre
  // maths is wrong.
  it("leaves the projected point under the cursor fixed", () => {
    const base = fitWorld(1400, 900);
    for (const factor of [1.1, 2, 8, 0.5, 0.25]) {
      for (const [sx, sy] of [[0, 0], [700, 450], [1399, 899], [200, 800]] as const) {
        const before = fromScreen(base, sx, sy, S);
        const zoomed = zoomAt(base, factor, sx, sy);
        const after = fromScreen(zoomed, sx, sy, S);
        expect(after[0]).toBeCloseTo(before[0], 3);
        expect(after[1]).toBeCloseTo(before[1], 3);
      }
    }
  });

  it("multiplies the scale by the factor, within the clamp", () => {
    const base = fitWorld(1400, 900);
    expect(zoomAt(base, 2, 700, 450).scale).toBeCloseTo(base.scale * 2, 6);
  });

  // Acceptance criterion 4.
  it("never zooms out past fit", () => {
    const base = fitWorld(1400, 900);
    expect(zoomAt(base, 0.1, 700, 450).scale).toBeCloseTo(base.scale, 6);
  });

  it("never zooms in past the maximum", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 50; i++) v = zoomAt(v, 2, 700, 450);
    expect(v.scale).toBeCloseTo(fitScale(1400, 900) * MAX_ZOOM_FACTOR, 6);
  });
});

describe("panBy", () => {
  it("moves the world by exactly the requested screen distance", () => {
    const v = zoomAt(fitWorld(1400, 900), 4, 700, 450);
    const before = fromScreen(v, 700, 450, S);
    const panned = panBy(v, 100, 0);
    const after = fromScreen(panned, 800, 450, S);
    expect(after[0]).toBeCloseTo(before[0], 3);
  });

  // Acceptance criterion 4.
  it("cannot push the world entirely off screen", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 100; i++) v = panBy(v, 10_000, 10_000);
    const [wx] = fromScreen(v, 700, 450, S);
    expect(Math.abs(wx / S)).toBeLessThanOrEqual(WORLD_HALF_WIDTH + 1e-6);
  });
});

describe("toScreen / fromScreen", () => {
  // Acceptance criterion 3. Milestone 1 only round-tripped at fit.
  it("round-trips within a pixel at every zoom level", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 6; i++) {
      for (const [x, y] of [[0, 0], [S, S], [-2 * S, S / 2]] as const) {
        const [sx, sy] = toScreen(v, x, y, S);
        const [bx, by] = fromScreen(v, sx, sy, S);
        const [rx, ry] = toScreen(v, bx, by, S);
        expect(Math.abs(rx - sx)).toBeLessThan(1);
        expect(Math.abs(ry - sy)).toBeLessThan(1);
      }
      v = zoomAt(v, 2, 700, 450);
    }
  });

  it("puts north at the top at every zoom level", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 4; i++) {
      const [, north] = toScreen(v, 0, S, S);
      const [, south] = toScreen(v, 0, -S, S);
      expect(north).toBeLessThan(south);
      v = zoomAt(v, 2, 700, 450);
    }
  });
});

describe("fitWorld", () => {
  // Acceptance criterion 2.
  it("is the identity that any pan and zoom sequence resets to", () => {
    const fit = fitWorld(1400, 900);
    let v = fit;
    v = zoomAt(v, 4, 300, 200);
    v = panBy(v, -250, 90);
    v = zoomAt(v, 0.5, 900, 700);
    const reset = fitWorld(v.width, v.height);
    expect(reset).toEqual(fit);
  });

  it("centres the world", () => {
    const v = fitWorld(1400, 900);
    expect(v.centreX).toBe(0);
    expect(v.centreY).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/transform.test.ts`
Expected: FAIL — `zoomAt` is not exported.

- [ ] **Step 3: Implement**

```ts
import { WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";

/**
 * A view of the projected world: where the centre of the canvas sits in
 * projected units, and how many screen pixels one projected unit occupies.
 *
 * Milestone 1 could describe a viewport by its offsets because there was only
 * ever one -- the whole world, centred. With zoom and pan the centre moves, so
 * it is stored rather than derived.
 */
export interface Viewport {
  width: number;
  height: number;
  /** Screen pixels per projected unit. */
  scale: number;
  /** Projected coordinates at the centre of the canvas. */
  centreX: number;
  centreY: number;
}

/** How far past fit-to-window zoom may go. Full detail is what makes this useful. */
export const MAX_ZOOM_FACTOR = 64;

export function fitScale(width: number, height: number): number {
  return Math.min(width / (WORLD_HALF_WIDTH * 2), height / (WORLD_HALF_HEIGHT * 2));
}

export function fitWorld(width: number, height: number): Viewport {
  return { width, height, scale: fitScale(width, height), centreX: 0, centreY: 0 };
}

export function toScreen(
  v: Viewport,
  x: number,
  y: number,
  coordScale: number,
): [number, number] {
  return [
    v.width / 2 + (x / coordScale - v.centreX) * v.scale,
    v.height / 2 - (y / coordScale - v.centreY) * v.scale,
  ];
}

export function fromScreen(
  v: Viewport,
  sx: number,
  sy: number,
  coordScale: number,
): [number, number] {
  return [
    (v.centreX + (sx - v.width / 2) / v.scale) * coordScale,
    (v.centreY - (sy - v.height / 2) / v.scale) * coordScale,
  ];
}

/**
 * Clamps scale to [fit, fit * MAX_ZOOM_FACTOR] and keeps the centre inside the
 * world, so the map can never be pushed entirely off screen or zoomed out into
 * empty space around it.
 */
function clamp(v: Viewport): Viewport {
  const min = fitScale(v.width, v.height);
  const scale = Math.min(Math.max(v.scale, min), min * MAX_ZOOM_FACTOR);
  // Half the visible extent, in projected units. When the view is wider than
  // the world there is nothing to clamp on that axis, so the centre pins to 0.
  const halfW = v.width / 2 / scale;
  const halfH = v.height / 2 / scale;
  const limitX = Math.max(0, WORLD_HALF_WIDTH - halfW);
  const limitY = Math.max(0, WORLD_HALF_HEIGHT - halfH);
  return {
    width: v.width,
    height: v.height,
    scale,
    centreX: Math.min(Math.max(v.centreX, -limitX), limitX),
    centreY: Math.min(Math.max(v.centreY, -limitY), limitY),
  };
}

/**
 * Zoom about a screen point, keeping the projected coordinate under that point
 * fixed. Anchoring at the cursor is what makes zoom feel controlled; anchoring
 * at the centre makes the map slide away from wherever you are looking.
 */
export function zoomAt(v: Viewport, factor: number, screenX: number, screenY: number): Viewport {
  const min = fitScale(v.width, v.height);
  const scale = Math.min(Math.max(v.scale * factor, min), min * MAX_ZOOM_FACTOR);
  // The world point under the cursor, before and after, must agree.
  const wx = v.centreX + (screenX - v.width / 2) / v.scale;
  const wy = v.centreY - (screenY - v.height / 2) / v.scale;
  return clamp({
    width: v.width,
    height: v.height,
    scale,
    centreX: wx - (screenX - v.width / 2) / scale,
    centreY: wy + (screenY - v.height / 2) / scale,
  });
}

/** Drag the map by a screen distance. */
export function panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return clamp({
    width: v.width,
    height: v.height,
    scale: v.scale,
    centreX: v.centreX - dxScreen / v.scale,
    centreY: v.centreY + dyScreen / v.scale,
  });
}
```

- [ ] **Step 4: Update existing consumers**

`render.test.ts` and `canvas.ts` reference `offsetX`/`offsetY`. Update them to the new shape. `render.test.ts`'s existing transform assertions must keep passing — if one now fails, decide whether the old assertion encoded the fit-only assumption, and say which in your report.

- [ ] **Step 5: Verify and commit**

```bash
pnpm vitest run packages/viewer/tests/transform.test.ts
pnpm lint && pnpm typecheck && pnpm test
git add packages/viewer
git commit -m "feat(viewer): zoom and pan in the viewport transform

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: World-space paths and the canvas transform

**Files:**
- Modify: `packages/viewer/src/render/canvas.ts`

**Interfaces:**
- Consumes: `Viewport`, `fitWorld` (Task 4).
- Produces: `MapRenderer` keeps `constructor(canvas, versions, land)`, `resize()`, `draw(frame)`, `readonly viewport`. Adds `setViewport(v: Viewport): void`.

Decision 0002 says pan and zoom are a canvas transform. They currently are not: `buildPath` bakes screen coordinates in via `toScreen`, and `resize()` clears the cache because those coordinates are valid for exactly one viewport. Under continuous zoom that cache would be invalidated every frame — 195 paths at up to 20,000 vertices — which would also repeal decision 0015's finding, since 0015 measured fills of an already-cached path set.

- [ ] **Step 1: Build paths in world space**

Change `buildPath` to divide by `coordScale` and emit **projected units**, dropping the `toScreen` call entirely. The path cache then no longer depends on the viewport, so `resize()` must stop clearing it — it should only be cleared on a level switch.

- [ ] **Step 2: Apply the viewport as a transform**

In `draw`, before filling anything:

```ts
const dpr = window.devicePixelRatio || 1;
const v = this.viewport;
// world -> screen, with Y flipped, then device pixels. Everything drawn after
// this is in projected units.
ctx.setTransform(
  dpr * v.scale,
  0,
  0,
  -dpr * v.scale,
  dpr * (v.width / 2 - v.centreX * v.scale),
  dpr * (v.height / 2 + v.centreY * v.scale),
);
```

The sea fill must be drawn *before* this transform is set, or in a `save`/`restore` pair with the identity transform, since it covers the canvas in screen space rather than world space.

- [ ] **Step 3: Keep stroke widths in screen pixels**

`POLITY_OUTLINE_WIDTH` (0.75) and `AGGREGATE_OUTLINE_WIDTH` (1.5) are screen measurements. Under the transform they would scale with zoom, so divide:

```ts
// Widths are screen pixels; the transform is in projected units, so undo it.
// Without this, borders thicken as you zoom until the map is all outline.
ctx.lineWidth = POLITY_OUTLINE_WIDTH / (dpr * v.scale) * dpr;
```

Work out the correct expression rather than copying this one blindly — it must produce a constant apparent width at every zoom level, and you should verify that by reasoning about the composed transform, not by eye.

- [ ] **Step 4: Add `setViewport`**

```ts
setViewport(v: Viewport): void {
  Object.assign(this.viewport, v);
}
```

The path cache is deliberately **not** cleared here. That is the entire point of the change, and it deserves the comment saying so.

- [ ] **Step 5: Verify**

There is no automated test for `canvas.ts` — it needs `Path2D` and a canvas, and the suite is `environment: "node"`. So typecheck and careful reading do this work. State in your report what you verified by execution and what only by reading.

Run `pnpm lint && pnpm typecheck && pnpm test`, then `pnpm dev` and confirm the app still boots and draws at fit-to-window.

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/render/canvas.ts
git commit -m "feat(viewer): build paths in world space, pan and zoom by transform

Decision 0002 always specified this. Baking screen coordinates into Path2D
meant the cache died on every viewport change, which under continuous zoom is
every frame.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Level selection with hysteresis

**Files:**
- Create: `packages/viewer/src/render/level.ts`
- Test: `packages/viewer/tests/level.test.ts`

**Interfaces:**
- Produces:
  - `type DetailLevel = "coarse" | "mid" | "full"`
  - `selectLevel(scale: number, fitScale: number, current: DetailLevel): DetailLevel`
  - `LEVEL_THRESHOLDS: { mid: number; full: number }` — multiples of fit scale, **from Task 1's measurement**
  - `HYSTERESIS: number` (0.8)
  - `landLevelFor(level: DetailLevel): "coarse" | "mid"`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  HYSTERESIS, LEVEL_THRESHOLDS, landLevelFor, selectLevel,
} from "../src/render/level";

const FIT = 258.6;

describe("selectLevel", () => {
  // Acceptance criterion 5.
  it("picks the level each threshold assigns", () => {
    expect(selectLevel(FIT, FIT, "coarse")).toBe("coarse");
    expect(selectLevel(FIT * LEVEL_THRESHOLDS.mid, FIT, "coarse")).toBe("mid");
    expect(selectLevel(FIT * LEVEL_THRESHOLDS.full, FIT, "mid")).toBe("full");
  });

  // Acceptance criterion 6. Without hysteresis, nudging the wheel across the
  // boundary triggers a 12 MB fetch and nudging back triggers another.
  it("does not switch back until well below the threshold", () => {
    const justOver = FIT * LEVEL_THRESHOLDS.mid * 1.01;
    expect(selectLevel(justOver, FIT, "coarse")).toBe("mid");
    const justUnder = FIT * LEVEL_THRESHOLDS.mid * 0.99;
    expect(selectLevel(justUnder, FIT, "mid")).toBe("mid");
    const wellUnder = FIT * LEVEL_THRESHOLDS.mid * HYSTERESIS * 0.99;
    expect(selectLevel(wellUnder, FIT, "mid")).toBe("coarse");
  });

  it("is stable: re-selecting at the same scale never oscillates", () => {
    let level: ReturnType<typeof selectLevel> = "coarse";
    for (const scale of [FIT, FIT * 3, FIT * 3, FIT * 20, FIT * 20, FIT * 3, FIT]) {
      const next = selectLevel(scale, FIT, level);
      expect(selectLevel(scale, FIT, next)).toBe(next);
      level = next;
    }
  });
});

describe("landLevelFor", () => {
  // Acceptance criterion 7. The pipeline emits land.0 and land.1 only.
  it("saturates at mid, because there is no land.2", () => {
    expect(landLevelFor("coarse")).toBe("coarse");
    expect(landLevelFor("mid")).toBe("mid");
    expect(landLevelFor("full")).toBe("mid");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/level.test.ts`
Expected: FAIL — cannot resolve `../src/render/level`.

- [ ] **Step 3: Implement**

Write `selectLevel` so that moving *up* a level happens at the threshold and moving *down* happens only below `threshold * HYSTERESIS`. Set `LEVEL_THRESHOLDS` from Task 1's measured figures, and cite them in a comment with the p99 displacement each came from — a constant with no provenance is one nobody can check.

- [ ] **Step 4: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/viewer/src/render/level.ts packages/viewer/tests/level.test.ts
git commit -m "feat(viewer): detail-level selection with hysteresis

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Per-level loading and the prefetch policy

**Files:**
- Create: `packages/viewer/src/data/levels.ts`
- Modify: `packages/viewer/src/data/artifacts.ts`
- Test: `packages/viewer/tests/levels.test.ts`

**Interfaces:**
- Produces:
  - `type LoadState = "absent" | "loading" | "resident" | "failed"`
  - `class LevelRegistry` with `constructor(fetcher: (level: DetailLevel) => Promise<VersionsArtifact>)`, `stateOf(level): LoadState`, `artifactOf(level): VersionsArtifact | null`, `request(level): void`, `onFirstPaint(): void`, `onFirstZoom(): void`
  - `bestAvailable(registry, wanted: DetailLevel): DetailLevel` — the finest resident level no finer than `wanted`, falling back to coarse.
- Consumes: `DetailLevel` (Task 6).

The registry is pure except for the injected fetcher, so the **policy** is unit-testable under `environment: "node"` while the fetch itself is not.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { bestAvailable, LevelRegistry } from "../src/data/levels";

const artifact = (level: string) => ({ schemaVersion: 2, level, coordScale: 1, rows: [], geometry: {} });

function registry() {
  const requested: string[] = [];
  const resolvers = new Map<string, (v: unknown) => void>();
  const r = new LevelRegistry((level) => {
    requested.push(level);
    return new Promise((resolve) => resolvers.set(level, resolve));
  });
  return { r, requested, settle: (l: string) => resolvers.get(l)?.(artifact(l)) };
}

describe("prefetch policy", () => {
  // Acceptance criterion 8.
  it("requests mid after first paint, and not before", () => {
    const { r, requested } = registry();
    expect(requested).toEqual([]);
    r.onFirstPaint();
    expect(requested).toEqual(["mid"]);
  });

  it("does not request full until a zoom has happened", () => {
    const { r, requested } = registry();
    r.onFirstPaint();
    expect(requested).not.toContain("full");
    r.onFirstZoom();
    expect(requested).toContain("full");
  });

  // Acceptance criterion 9.
  it("never re-requests a level already resident or in flight", async () => {
    const { r, requested, settle } = registry();
    r.onFirstPaint();
    r.request("mid");
    r.request("mid");
    settle("mid");
    await Promise.resolve();
    r.request("mid");
    expect(requested.filter((l) => l === "mid")).toHaveLength(1);
  });

  it("does not retry a failed level on every subsequent request", async () => {
    const requested: string[] = [];
    const r = new LevelRegistry((level) => {
      requested.push(level);
      return Promise.reject(new Error("network"));
    });
    r.request("full");
    await Promise.resolve();
    await Promise.resolve();
    r.request("full");
    r.request("full");
    expect(requested.filter((l) => l === "full")).toHaveLength(1);
    expect(r.stateOf("full")).toBe("failed");
  });
});

describe("bestAvailable", () => {
  it("falls back to the finest resident level no finer than wanted", async () => {
    const { r, settle } = registry();
    expect(bestAvailable(r, "full")).toBe("coarse");
    r.request("mid");
    settle("mid");
    await Promise.resolve();
    expect(bestAvailable(r, "full")).toBe("mid");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/levels.test.ts`
Expected: FAIL — cannot resolve `../src/data/levels`.

- [ ] **Step 3: Implement the registry**

Coarse is resident from startup — `main.ts` already loads it — so seed its state accordingly. `request` is a no-op for any level not `absent`, which is what makes criteria 9 and the no-retry rule hold. A rejected fetch sets `failed` and is never retried.

- [ ] **Step 4: Add per-level fetching**

In `artifacts.ts`, add `fetchVersions(level: DetailLevel, base?: string): Promise<VersionsArtifact>` mapping `coarse|mid|full` to `versions.0|1|2.json` via `LEVEL_INDEX` from `@history/model`, asserting `schemaVersion` exactly as the existing loader does. Issue prefetches with low priority:

```ts
// Deprioritised so a background prefetch cannot compete with anything the
// user actually triggered.
const res = await fetch(`${base}/${name}`, { priority: "low" } as RequestInit);
```

`priority` is not in the DOM lib's `RequestInit` yet; the cast is deliberate and should say so.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/viewer/src/data packages/viewer/tests/levels.test.ts
git commit -m "feat(viewer): per-level loading with a prefetch policy

Mid after first paint, full after the first zoom. Common path 7.36 MB
rather than 19.4 MB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Viewport-scoped change queries

**Files:**
- Modify: `packages/viewer/src/engine/change-years.ts`, `packages/viewer/src/engine/engine.ts`
- Test: `packages/viewer/tests/change-years.test.ts`

**Interfaces:**
- Consumes: `cellRangeFor`, `ChangesArtifact` from `@history/model` (Task 3).
- Produces:
  - `class ChangeYears` with `constructor(changes: ChangesArtifact)`, `nextChangeAfter(year: number, bbox: [number, number, number, number] | null): number | null`. A null bbox means the whole world.
  - `Engine` gains `setViewportBbox(bbox: [number, number, number, number] | null): void`.

**The engine must not learn about pixels.** The bbox is plain projected-unit numbers computed in `render/` and handed down. Passing a `Viewport` would put a rendering type in the engine and break the boundary this milestone is most likely to erode.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { ChangesArtifact, VersionsArtifact } from "@history/model";
import { ChangeYears } from "../src/engine/change-years";

const changes = readArtifact<ChangesArtifact>("fixtures/dist/changes.json");
const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("ChangeYears", () => {
  const cy = new ChangeYears(changes);
  const WORLD = changes.grid.bounds as [number, number, number, number];

  // Acceptance criterion 10.
  it("returns the smallest event year strictly greater than the query", () => {
    let year = -10_000;
    for (let i = 0; i < 50; i++) {
      const next = cy.nextChangeAfter(year, WORLD);
      if (next === null) break;
      expect(next).toBeGreaterThan(year);
      year = next;
    }
  });

  it("returns null past the last event", () => {
    expect(cy.nextChangeAfter(1e9, WORLD)).toBeNull();
  });

  // Acceptance criterion 11. The two implementations must agree where their
  // domains overlap -- a world bbox is exactly Milestone 1's question.
  it("agrees with the row-derived sequence for a world-wide bbox", () => {
    const fromRows = [
      ...new Set(versions.rows.flatMap((r) => [r.fromYear, r.toYear + 1])),
    ].sort((a, b) => a - b);
    const fromIndex: number[] = [];
    let year = Number.NEGATIVE_INFINITY;
    for (;;) {
      const next = cy.nextChangeAfter(year, WORLD);
      if (next === null) break;
      fromIndex.push(next);
      year = next;
    }
    expect(fromIndex).toEqual(fromRows);
  });

  it("returns fewer events for a small bbox than for the world", () => {
    const [minX, minY, maxX, maxY] = WORLD;
    const tiny: [number, number, number, number] = [
      minX + (maxX - minX) * 0.5,
      minY + (maxY - minY) * 0.5,
      minX + (maxX - minX) * 0.52,
      minY + (maxY - minY) * 0.52,
    ];
    const count = (bbox: [number, number, number, number] | null) => {
      let n = 0;
      let year = Number.NEGATIVE_INFINITY;
      for (;;) {
        const next = cy.nextChangeAfter(year, bbox);
        if (next === null) return n;
        n++;
        year = next;
      }
    };
    expect(count(tiny)).toBeLessThan(count(WORLD));
  });

  it("treats a null bbox as the whole world", () => {
    expect(cy.nextChangeAfter(-10_000, null)).toBe(cy.nextChangeAfter(-10_000, WORLD));
  });
});
```

Criterion 11 depends on Task 2 having landed — before it, the index holds `toYear` and the sequences cannot match. If it fails, check Task 2 is in before changing anything here.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/change-years.test.ts`
Expected: FAIL — the constructor takes rows, not a `ChangesArtifact`.

- [ ] **Step 3: Implement**

Build a sorted, deduplicated year list per cell at construction. A query takes `cellRangeFor(changes.grid, bbox)`, walks the covered cells, and returns the smallest year greater than the query across them. Cache the world-wide list, since a null bbox is the common case while zoomed out.

Note the index is built from **polygon** bounding boxes, so a query can report a change just outside the visible shape. That is documented in 0013 and is the intended trade: a brief pause for something slightly off-screen shows more than necessary rather than skipping something real. Say so in a comment.

- [ ] **Step 4: Wire the engine**

`Engine`'s constructor takes the `ChangesArtifact` alongside the versions artifact, stores a nullable bbox set by `setViewportBbox`, and passes it to `nextChangeAfter` in `advance`. Update `main.ts` to load `changes.json` again — Milestone 1 deliberately stopped fetching it, and the comment in `artifacts.ts` saying so must be corrected rather than left contradicting the code.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add packages/viewer
git commit -m "feat(viewer): scope change queries to the viewport

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Wheel, drag, and the level readout

**Files:**
- Modify: `packages/viewer/src/ui/chrome.ts`, `packages/viewer/src/main.ts`

**Interfaces:**
- Consumes: `zoomAt`, `panBy`, `fitWorld` (Task 4); `selectLevel`, `landLevelFor` (Task 6); `LevelRegistry`, `bestAvailable` (Task 7); `Engine.setViewportBbox` (Task 8); `MapRenderer.setViewport` (Task 5).

- [ ] **Step 1: Wire interaction**

Wheel zooms about the cursor. Drag pans. A **Reset** control returns to `fitWorld`. Follow the existing chrome pattern: the control reads its state from what the renderer actually holds rather than from shadow state.

Two details that bite:

- `wheel` must call `preventDefault`, and the listener must be registered with `{ passive: false }` or the browser ignores it and scrolls the page instead.
- Drag must use pointer capture, and must reset on `pointercancel` as well as `pointerup`. Milestone 1 shipped a stuck-scrubber bug from exactly this omission; do not repeat it.

- [ ] **Step 2: Drive level selection each frame**

In the animation loop: compute the wanted level from `viewport.scale`, ask the registry for it, draw with `bestAvailable`, and give the engine the viewport's bbox in projected units:

```ts
const bbox: [number, number, number, number] = [
  viewport.centreX - viewport.width / 2 / viewport.scale,
  viewport.centreY - viewport.height / 2 / viewport.scale,
  viewport.centreX + viewport.width / 2 / viewport.scale,
  viewport.centreY + viewport.height / 2 / viewport.scale,
];
engine.setViewportBbox(bbox);
```

Call `registry.onFirstPaint()` once after the first successful draw, and `registry.onFirstZoom()` on the first zoom interaction.

- [ ] **Step 3: Show the level**

A small readout saying which detail level is drawing, and an unobtrusive indicator while a finer one is loading. The owner needs to tell "this is coarse because it is still loading" from "this is coarse and that is all there is" during the feel session.

- [ ] **Step 4: Verify by hand**

```bash
pnpm build && pnpm dev
```

Check: wheel zooms about the cursor and does not scroll the page; drag pans and stops at the world edge; reset returns to fit; the level readout changes at the thresholds; zooming into a sparse region visibly accelerates playback while a dense European view does not.

Record `viewport.scale` at each threshold crossing and confirm it matches `LEVEL_THRESHOLDS`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src
git commit -m "feat(viewer): wheel zoom, drag pan, and the level readout

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The criterion, the records, and the docs

**Files:**
- Modify: `docs/phase-1-importer.md`, `.github/workflows/full-build.yml`, `docs/architecture.md`, `packages/model/src/canon.ts`, `packages/viewer/README.md`
- Create: `docs/decisions/0020-percentile-displacement.md`, `docs/decisions/0021-artifacts-load-whole.md`

- [ ] **Step 1: Replace the no-new-gaps criterion**

`docs/phase-1-importer.md` states it as a one-pixel bound on the **maximum**. Task 1 will have confirmed the maximum is the same seven arcs at coarse and mid, so a max-based criterion cannot distinguish the levels and mid can never pass it.

Replace it with: **at each level's own threshold scale, that level's p99 displacement stays under one screen pixel.** Amend the Phase 1 document to point at decision 0020 rather than silently rewriting it.

- [ ] **Step 2: Add the check to the full build**

Add a step to `.github/workflows/full-build.yml` running `pnpm displacement` and failing if any level's p99 exceeds one pixel at its threshold scale. It belongs there rather than in `pnpm test` because the fixture's 620 shared arcs are far too thin to characterise a percentile — the full build has 22,215.

- [ ] **Step 3: Write decision 0020**

Records that the maximum is the same seven ~0.0029-unit events at coarse and mid and therefore cannot discriminate; that the percentile does; that the criterion is now measured at each level's own threshold scale; and the measured figures from Task 1. Argue against the max-based version explicitly — `CLAUDE.md` requires that, and a future reader will otherwise restore it as the more obviously correct rule.

- [ ] **Step 4: Write decision 0021**

Records the payload and heap table, that all three levels resident cost 331 MB which is inside a desktop budget, and that region-chunked artifacts were therefore rejected. Name the measurement that would change the answer: an order-of-magnitude larger dataset. The instinct on seeing a 73 MB artifact is to chunk it; this says why not yet.

- [ ] **Step 5: Correct `canon.ts`**

`PX_PER_UNIT` is no longer consulted by the renderer, which uses `viewport.scale`. Rewrite its doc comment to say it is the reference scale at which the acceptance criterion is measured, and replace the provisional values with the measured ones. Leaving "PROVISIONAL" on a constant that is now measured is exactly the stale-record defect this project keeps finding.

- [ ] **Step 6: Update the narrative docs**

`docs/architecture.md` describes a viewer with no zoom. Update the viewer section for zoom, level switching and prefetch, and mention 0020 and 0021. Update `packages/viewer/README.md` for the new modules.

Do not describe zoom or level switching as validated — the owner has not yet used them, and that is the milestone's exit condition.

- [ ] **Step 7: Verify and commit**

```bash
nvm use && pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm --filter @history/viewer build
git add docs .github packages
git commit -m "docs: percentile displacement criterion, and why artifacts load whole

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Milestone exit conditions

Not tests, and the milestone is not done without them.

- [ ] **Deployed**, with the app and its data from one commit.
- [ ] **The owner zooms into a dense region and a sparse one** and judges whether viewport-scoped acceleration reads as intended given the 91% concentration over Europe, and whether level switching is visible in a way that distracts.
- [ ] **`AGGREGATE_OUTLINE_WIDTH`** is tuned, carried over from Milestone 1 where the owner found it slightly thick.
