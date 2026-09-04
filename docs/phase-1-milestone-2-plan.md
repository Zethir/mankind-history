# Phase 1, Milestone 2 — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Phase 1 by adding the two coarser detail levels, the spatially-bucketed change index, and the playback-density diagnostic, with the three remaining acceptance criteria green.

**Architecture:** A new cached `pipeline simplify` command runs mapshaper over the projected full-detail geometry once per level, preserving shared topology so neighbouring borders move together. The build then emits three version levels plus a grid index that buckets polygons — not versions — by projected bounding box. A `pipeline histogram` diagnostic reads the shipped artifacts and reports how much of the timeline adaptive playback would fast-forward.

**Tech Stack:** TypeScript 5.9 (`strict`), Node 22 (ESM), pnpm workspaces, Vitest 3.2, Biome, mapshaper.

**Spec:** `docs/phase-1-milestone-2-design.md`. Read it before starting — it carries the measurements that justify several choices here, particularly why the index buckets polygons rather than versions. `docs/phase-1-importer.md` is the canonical phase spec.

## Global Constraints

- **Node 22.** Shell state does not persist between commands and the system default is Node 20, so **every** command running node, pnpm or vitest must be prefixed with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use`. **Never pipe `nvm use` into anything** — piping runs it in a subshell and the PATH change is silently discarded.
- **TypeScript `strict: true`**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Array and `Record` indexing yields `T | undefined`.
- **ESM only.** No CommonJS.
- **Root `lint` is `biome check --error-on-warnings .`** — warnings fail the build. Fix your own code rather than weakening a rule.
- **Source, test and markdown files must be pure ASCII.** Use `\uXXXX` escapes in string literals and plain ASCII punctuation in comments. `.geojson` fixtures and `fixtures/dist/` output are data and exempt. Check with `LC_ALL=C grep -n '[^ -~]'` before each commit.
- **Builds are deterministic.** Byte-identical output from identical inputs, scoped to the pinned toolchain (decision 0010). No wall-clock time in any `dist/` file.
- **Every artifact goes through `writeArtifact`** from `@history/model/artifact` — the single choke point enforcing sorted keys, LF endings and a trailing newline. Never `JSON.stringify` + `writeFileSync` for artifact content.
- **Never invent geometry.** No interpolation, no clipping that creates a border. Simplification moves vertices; it must never delete a whole polygon (hence `keep-shapes`).
- **Land is not simplified.** Natural Earth's 110m and 50m releases are the two land levels already.
- **`data/` and `dist/` are git-ignored**; `fixtures/` and `fixtures/dist/` are committed.
- The npm script for fetching is **`fetch:sources`**, not `fetch` — `pnpm fetch` is a pnpm built-in that shadows scripts.
- Commit after every task, conventional-commit prefixes.

## File Structure

**Created**
- `packages/pipeline/src/stages/simplify.ts` — mapshaper wrapper. Takes projected geometry, returns simplified geometry per level. No I/O.
- `packages/pipeline/src/stages/change-index.ts` — builds the grid index from geometry. Pure.
- `packages/pipeline/src/stages/histogram.ts` — density and acceleration analysis over an artifact set. Pure.
- `packages/pipeline/src/regions.ts` — region and era presets. Pipeline-only, not part of the artifact contract.
- `docs/decisions/0013-index-buckets-polygons.md`

**Modified**
- `packages/model/src/canon.ts` — `GRID`, `PX_PER_UNIT`, `SIMPLIFY_PERCENT`
- `packages/model/src/types.ts` — `ChangesArtifact`
- `packages/pipeline/src/stages/emit.ts` — three version levels plus `changes.json`
- `packages/pipeline/src/build.ts` — orchestration
- `packages/pipeline/src/cli.ts` — `simplify` and `histogram` subcommands
- `packages/pipeline/package.json`, root `package.json` — dependency and scripts
- `packages/pipeline/tests/acceptance.test.ts` — three new criteria, existing geometry criteria extended
- `.github/workflows/full-build.yml` — assert the budget rather than print it
- `docs/architecture.md`, `packages/*/README.md`

Each stage stays a pure function taking data and returning data. Only `emit.ts`, `build.ts` and `cli.ts` touch the filesystem — the property that makes the acceptance criteria testable without fixtures on disk.

---

### Task 1: mapshaper, and proving it is deterministic

The spec names this the milestone's main risk. mapshaper is the first dependency doing real geometric work, and decision 0010 scopes byte-identical output to a pinned toolchain. If mapshaper varies between runs the golden artifacts become noise. Settle it before building anything on top.

**Files:**
- Create: `packages/pipeline/src/stages/simplify.ts`
- Modify: `packages/pipeline/package.json`
- Test: `packages/pipeline/tests/simplify.test.ts`

**Interfaces:**
- Consumes: `Polygon`, `Ring` from `@history/model`.
- Produces: `simplifyPolygonGroups(groups: SimplifyInput[], percent: number): Promise<Map<string, Polygon[]>>` where `SimplifyInput` is `{ id: string; polygons: Polygon[] }`. Input and output coordinates are both scaled integers at `COORD_SCALE.full`; rescaling to a level's own scale happens later, in Task 3.

- [ ] **Step 1: Add the dependency**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm --filter @history/pipeline add mapshaper
```

mapshaper ships its own TypeScript types; if `pnpm typecheck` disagrees, create `packages/pipeline/src/mapshaper.d.ts` declaring only what this task uses:

```typescript
declare module "mapshaper" {
  export function applyCommands(
    commands: string,
    input: Record<string, string | Buffer>,
  ): Promise<Record<string, Uint8Array>>;
}
```

- [ ] **Step 2: Write the failing test**

`packages/pipeline/tests/simplify.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { simplifyPolygonGroups } from "../src/stages/simplify";

/** A closed square ring as flat scaled-integer coordinates. */
const square = (x: number, y: number, size: number): number[] => [
  x, y,
  x + size, y,
  x + size, y + size,
  x, y + size,
  x, y,
];

/** A ring with many collinear-ish points that simplification should thin. */
function noisyRing(x: number, y: number, size: number, points: number): number[] {
  const flat: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / points;
    const angle = t * Math.PI * 2;
    const r = size * (0.9 + 0.1 * Math.sin(angle * 7));
    flat.push(Math.round(x + Math.cos(angle) * r), Math.round(y + Math.sin(angle) * r));
  }
  flat.push(flat[0] as number, flat[1] as number);
  return flat;
}

describe("simplifyPolygonGroups", () => {
  it("returns one entry per input id", async () => {
    const out = await simplifyPolygonGroups(
      [
        { id: "a", polygons: [[square(0, 0, 1000)]] },
        { id: "b", polygons: [[square(5000, 0, 1000)]] },
      ],
      50,
    );
    expect([...out.keys()].sort()).toEqual(["a", "b"]);
  });

  it("removes vertices at a low retention percentage", async () => {
    const ring = noisyRing(0, 0, 100000, 200);
    const out = await simplifyPolygonGroups([{ id: "a", polygons: [[ring]] }], 10);
    const simplified = out.get("a")?.[0]?.[0] as number[];
    expect(simplified.length).toBeLessThan(ring.length);
    expect(simplified.length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every polygon, so a small shape cannot vanish (keep-shapes)", async () => {
    const groups = [
      { id: "big", polygons: [[noisyRing(0, 0, 1000000, 400)]] },
      { id: "tiny", polygons: [[square(9000000, 9000000, 50)]] },
    ];
    const out = await simplifyPolygonGroups(groups, 2);
    expect(out.get("tiny")?.length).toBe(1);
    expect(out.get("big")?.length).toBe(1);
  });

  it("emits closed rings of at least four points with integer coordinates", async () => {
    const out = await simplifyPolygonGroups(
      [{ id: "a", polygons: [[noisyRing(0, 0, 500000, 120)]] }],
      25,
    );
    for (const polygon of out.get("a") ?? []) {
      for (const ring of polygon) {
        expect(ring.length % 2).toBe(0);
        expect(ring.length / 2).toBeGreaterThanOrEqual(4);
        expect(ring.every(Number.isInteger)).toBe(true);
        expect(ring[0]).toBe(ring[ring.length - 2]);
        expect(ring[1]).toBe(ring[ring.length - 1]);
      }
    }
  });

  it("is deterministic: the same input twice gives byte-identical output", async () => {
    // This is the milestone's headline risk. Decision 0010 scopes byte-identical
    // builds to a pinned toolchain; if mapshaper varies between runs, the golden
    // fixture artifacts become noise and the determinism criterion is unfounded.
    const groups = [
      { id: "a", polygons: [[noisyRing(0, 0, 800000, 300)]] },
      { id: "b", polygons: [[noisyRing(2000000, 500000, 600000, 250)]] },
      { id: "c", polygons: [[square(-1000000, -1000000, 400000)]] },
    ];
    const first = await simplifyPolygonGroups(groups, 15);
    const second = await simplifyPolygonGroups(groups, 15);
    expect(JSON.stringify([...second])).toBe(JSON.stringify([...first]));
  });

  it("preserves a vertex shared between two polygons in both or neither", async () => {
    // Shared topology is the whole mechanism by which neighbouring borders stay
    // aligned. Two squares sharing an edge must keep sharing it.
    const shared: number[] = [0, 0, 0, 100000, 100000, 100000, 100000, 0, 0, 0];
    const neighbour: number[] = [
      0, 0, 100000, 0, 100000, -100000, 0, -100000, 0, 0,
    ];
    const out = await simplifyPolygonGroups(
      [
        { id: "north", polygons: [[shared]] },
        { id: "south", polygons: [[neighbour]] },
      ],
      50,
    );
    const pts = (id: string) => {
      const set = new Set<string>();
      for (const polygon of out.get(id) ?? []) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length; i += 2) set.add(`${ring[i]},${ring[i + 1]}`);
        }
      }
      return set;
    };
    const north = pts("north");
    const south = pts("south");
    for (const p of ["0,0", "100000,0"]) {
      expect(north.has(p)).toBe(south.has(p));
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/pipeline/tests/simplify.test.ts`
Expected: FAIL — cannot resolve `../src/stages/simplify`.

- [ ] **Step 4: Write the implementation**

`packages/pipeline/src/stages/simplify.ts`:

```typescript
import type { Polygon, Ring } from "@history/model";
import { applyCommands } from "mapshaper";

export interface SimplifyInput {
  id: string;
  polygons: Polygon[];
}

/** GeoJSON position array for one ring, from our flat scaled-integer form. */
function ringToCoords(ring: Ring): number[][] {
  const out: number[][] = new Array(ring.length / 2);
  for (let i = 0; i < ring.length; i += 2) {
    out[i / 2] = [ring[i] as number, ring[i + 1] as number];
  }
  return out;
}

function coordsToRing(coords: number[][]): Ring {
  const flat: Ring = new Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    const p = coords[i] as number[];
    flat[i * 2] = Math.round(p[0] as number);
    flat[i * 2 + 1] = Math.round(p[1] as number);
  }
  return flat;
}

/**
 * Topology-preserving simplification via mapshaper.
 *
 * Every group goes through ONE mapshaper call so topology is shared: mapshaper
 * detects arcs common to neighbouring polygons and simplifies them identically,
 * which is what stops gaps opening between borders. Do not "optimise" this into
 * one call per group -- that discards the shared topology and is the specific
 * failure the no-new-gaps acceptance criterion exists to catch.
 *
 * Coordinates in and out are scaled integers at COORD_SCALE.full. mapshaper
 * treats them as planar, which is what we want: they are already projected, and
 * Equal Earth is equal-area, so an area threshold means the same real area
 * everywhere.
 *
 * `keep-shapes` stops small polities being removed entirely. A state vanishing
 * because it was small would be exactly the silent falsehood this project
 * forbids.
 */
export async function simplifyPolygonGroups(
  groups: SimplifyInput[],
  percent: number,
): Promise<Map<string, Polygon[]>> {
  const features = groups.map((g) => ({
    type: "Feature" as const,
    properties: { id: g.id },
    geometry: {
      type: "MultiPolygon" as const,
      coordinates: g.polygons.map((polygon) => polygon.map(ringToCoords)),
    },
  }));

  const input = JSON.stringify({ type: "FeatureCollection", features });
  const command =
    `-i in.json -simplify visvalingam weighted ${percent}% keep-shapes -o out.json`;
  const result = await applyCommands(command, { "in.json": input });
  const raw = result["out.json"];
  if (!raw) throw new Error("mapshaper produced no output");

  const parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as {
    features: Array<{
      properties: { id: string };
      geometry: { type: string; coordinates: unknown } | null;
    }>;
  };

  const out = new Map<string, Polygon[]>();
  for (const feature of parsed.features) {
    const g = feature.geometry;
    if (!g) continue;
    const groupsOut =
      g.type === "Polygon"
        ? [g.coordinates as number[][][]]
        : g.type === "MultiPolygon"
          ? (g.coordinates as number[][][][])
          : [];
    out.set(
      feature.properties.id,
      groupsOut.map((rings) => rings.map(coordsToRing)),
    );
  }
  return out;
}
```

- [ ] **Step 5: Run the test and the gates**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/pipeline/tests/simplify.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS, 6 tests, both gates exit 0.

**If the determinism test fails, stop and report it.** That is the milestone's central risk materialising, and it changes the design rather than being something to work around.

- [ ] **Step 6: Prove determinism on real geometry, not just synthetic**

Synthetic squares are a weak test of a topology engine. Write a scratch probe under `.superpowers/` (git-ignored), run it with `pnpm exec tsx`, report the numbers, then delete it. It must load `dist/versions.2.json`, take the first 2,000 versions' polygons, run `simplifyPolygonGroups` twice at 10%, and compare the serialised results. Relative imports from that directory are `../../../packages/...`; `readFileSync` paths are relative to the repo root. If `dist/` is absent, run `pnpm build` first.

Report: whether the two runs matched, the input and output vertex counts, and how long one run took.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline package.json pnpm-lock.yaml
git commit -m "feat(pipeline): topology-preserving simplification via mapshaper"
```

---

### Task 2: Shared constants and the changes artifact type

Small, but every later task depends on it. `PX_PER_UNIT` encodes a Phase 2 assumption that does not exist yet, so it must be marked provisional in the source rather than presented as measured fact.

**Files:**
- Modify: `packages/model/src/canon.ts`, `packages/model/src/types.ts`
- Test: `packages/model/tests/types.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `GRID: { cols: number; rows: number }`, `WORLD_HALF_HEIGHT: number`, `PX_PER_UNIT: Record<LevelName, number>`, and the `ChangesArtifact` interface.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("canonical types", ...)` block in `packages/model/tests/types.test.ts`:

```typescript
  it("pins the grid and viewport constants the change index depends on", () => {
    expect(GRID.cols).toBe(64);
    expect(GRID.rows).toBe(32);
    // Half the projected world height: y at lat 90.
    expect(WORLD_HALF_HEIGHT).toBeCloseTo(1.31736, 5);
    // Provisional Phase 2 viewport assumptions -- a 1400px-wide window showing
    // the whole world at coarse, an eighth of it at mid, a sixty-fourth at full.
    expect(PX_PER_UNIT.coarse).toBe(259);
    expect(PX_PER_UNIT.mid).toBe(2069);
    expect(PX_PER_UNIT.full).toBe(16552);
  });

  it("a ChangesArtifact carries a row-major grid of sorted year lists", () => {
    const changes: ChangesArtifact = {
      schemaVersion: 1,
      grid: { cols: 2, rows: 1, bounds: [-1, -1, 1, 1] },
      cells: [[-200, 14], [476]],
    };
    expect(changes.cells).toHaveLength(2);
    expect(changes.grid.bounds[2]).toBe(1);
  });
```

Extend the imports at the top of that file to include `GRID`, `PX_PER_UNIT`, `WORLD_HALF_HEIGHT` from `../src/canon` and `type ChangesArtifact` from `../src/types`.

- [ ] **Step 2: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/model/tests/types.test.ts`
Expected: FAIL — `GRID` is not exported.

- [ ] **Step 3: Add the constants**

Append to `packages/model/src/canon.ts`:

```typescript
/** Half the projected world height: y at lat 90. */
export const WORLD_HALF_HEIGHT = 1.31736;

/**
 * Change-index grid, uniform over projected space. Because the projection is
 * equal-area, uniform cells mean uniform real area per cell rather than uniform
 * degrees.
 *
 * 64x32 measured at 33 KB gzipped over the real dataset, against 9 KB for
 * 24x12 -- the index is negligible at every resolution tried, so this is chosen
 * for query precision rather than size. See
 * docs/decisions/0013-index-buckets-polygons.md.
 */
export const GRID = { cols: 64, rows: 32 } as const;

/**
 * PROVISIONAL. Screen pixels per projected unit at the coarsest zoom each level
 * is expected to serve, used only by the no-new-gaps acceptance criterion.
 *
 * These encode a Phase 2 viewport assumption that does not exist yet: a
 * 1400-pixel-wide window showing the whole world at coarse, an eighth of it at
 * mid, and a sixty-fourth at full. The projected world is 5.4133 units wide.
 * Phase 2 should replace these with the viewer's real figures.
 */
export const PX_PER_UNIT = {
  coarse: 259,
  mid: 2069,
  full: 16552,
} as const;
```

- [ ] **Step 4: Add the artifact type**

Append to `packages/model/src/types.ts`:

```typescript
/**
 * Change-year index. Backs decision 0006's viewport-scoped nextVisibleChange:
 * given a year and a viewport, the next year in which anything visible starts
 * or ends.
 *
 * Buckets POLYGONS, not versions -- a scattered empire's overall bounding box
 * covers most of the world while its individual polygons do not. See
 * docs/decisions/0013-index-buckets-polygons.md.
 */
export interface ChangesArtifact {
  schemaVersion: number;
  /** `bounds` is in unscaled projected units, so the grid is level-independent. */
  grid: { cols: number; rows: number; bounds: [number, number, number, number] };
  /** Row-major, cols * rows entries. Each a sorted, deduplicated year list. */
  cells: number[][];
}
```

- [ ] **Step 5: Verify and commit**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm test && pnpm lint && pnpm typecheck
LC_ALL=C grep -n '[^ -~]' packages/model/src/canon.ts packages/model/src/types.ts packages/model/tests/types.test.ts
git add packages/model
git commit -m "feat(model): grid, viewport and changes-artifact constants"
```

The grep must print nothing. Expect the suite to grow by 2 tests.

---

### Task 3: The change index

A pure stage: geometry in, grid out. Also provides the query and a brute-force equivalent, because the acceptance criterion compares them and both must use the same predicate for the comparison to mean anything.

**Files:**
- Create: `packages/pipeline/src/stages/change-index.ts`
- Test: `packages/pipeline/tests/change-index.test.ts`

**Interfaces:**
- Consumes: `GRID`, `WORLD_HALF_WIDTH`, `WORLD_HALF_HEIGHT`, `SCHEMA_VERSION`, `ChangesArtifact`, `Version`, `VersionGeometry`, `Polygon` from `@history/model`.
- Produces: `polygonBbox(polygon: Polygon): [number, number, number, number]`, `buildChangeIndex(versions, geometry, coordScale): ChangesArtifact`, `nextChangeAfter(index: ChangesArtifact, year: number, bbox: [number,number,number,number]): number | null`, and `nextChangeBruteForce(versions, geometry, coordScale, year, bbox): number | null`. All `bbox` arguments to the query functions are in **unscaled projected units**.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/change-index.test.ts`:

```typescript
import { COORD_SCALE, GRID, type Version, type VersionGeometry } from "@history/model";
import { describe, expect, it } from "vitest";
import {
  buildChangeIndex,
  nextChangeAfter,
  nextChangeBruteForce,
  polygonBbox,
} from "../src/stages/change-index";

const S = COORD_SCALE.full;

function version(id: string, fromYear: number, toYear: number): Version {
  return {
    id,
    polityId: `name:${id}`,
    fromYear,
    toYear,
    area: 1,
    prevId: null,
    delta: null,
    gap: null,
    confidence: null,
    source: { dataset: "cliopatria", version: "v0.2.0" },
  };
}

/** A square polygon in unscaled projected units, stored as scaled integers. */
function squareAt(x: number, y: number, size: number): VersionGeometry {
  const i = (v: number) => Math.round(v * S);
  return {
    polygons: [
      [[i(x), i(y), i(x + size), i(y), i(x + size), i(y + size), i(x), i(y + size), i(x), i(y)]],
    ],
    bbox: [i(x), i(y), i(x + size), i(y + size)],
    anchor: [i(x + size / 2), i(y + size / 2)],
  };
}

describe("polygonBbox", () => {
  it("bounds a polygon from its own rings, not from the version", () => {
    const g = squareAt(0, 0, 1);
    expect(polygonBbox(g.polygons[0] as number[][])).toEqual([0, 0, S, S]);
  });
});

describe("buildChangeIndex", () => {
  it("produces a row-major grid of the declared size", () => {
    const index = buildChangeIndex([version("a", 0, 10)], { a: squareAt(0, 0, 0.1) }, S);
    expect(index.grid.cols).toBe(GRID.cols);
    expect(index.grid.rows).toBe(GRID.rows);
    expect(index.cells).toHaveLength(GRID.cols * GRID.rows);
  });

  it("records both the start and the end year of every version", () => {
    const index = buildChangeIndex([version("a", -200, 476)], { a: squareAt(0, 0, 0.1) }, S);
    const years = index.cells.flat();
    expect(years).toContain(-200);
    expect(years).toContain(476);
  });

  it("sorts and deduplicates each cell", () => {
    const index = buildChangeIndex(
      [version("a", 100, 200), version("b", 100, 300)],
      { a: squareAt(0, 0, 0.1), b: squareAt(0, 0, 0.1) },
      S,
    );
    for (const cell of index.cells) {
      expect([...cell].sort((x, y) => x - y)).toEqual(cell);
      expect(new Set(cell).size).toBe(cell.length);
    }
    const populated = index.cells.filter((c) => c.length > 0);
    expect(populated[0]).toEqual([100, 200, 300]);
  });

  it("buckets each polygon separately, so a scattered version does not claim the span between its parts", () => {
    // Two small squares far apart. Bucketing the VERSION by its overall bbox
    // would fill every cell between them; bucketing each POLYGON does not.
    const scattered: VersionGeometry = {
      polygons: [
        (squareAt(-2.5, -1.2, 0.1).polygons[0] as number[][]),
        (squareAt(2.4, 1.1, 0.1).polygons[0] as number[][]),
      ],
      bbox: [Math.round(-2.5 * S), Math.round(-1.2 * S), Math.round(2.5 * S), Math.round(1.2 * S)],
      anchor: [0, 0],
    };
    const index = buildChangeIndex([version("a", 5, 6)], { a: scattered }, S);
    const populated = index.cells.filter((c) => c.length > 0).length;
    expect(populated).toBeLessThan(10);
  });
});

describe("nextChangeAfter", () => {
  const versions = [version("a", 100, 200), version("b", 900, 1000)];
  const geometry = { a: squareAt(0, 0, 0.2), b: squareAt(0, 0, 0.2) };
  const index = buildChangeIndex(versions, geometry, S);

  it("finds the next change strictly after the given year", () => {
    expect(nextChangeAfter(index, 0, [-0.1, -0.1, 0.3, 0.3])).toBe(100);
    expect(nextChangeAfter(index, 100, [-0.1, -0.1, 0.3, 0.3])).toBe(200);
    expect(nextChangeAfter(index, 200, [-0.1, -0.1, 0.3, 0.3])).toBe(900);
  });

  it("returns null when nothing changes later in that viewport", () => {
    expect(nextChangeAfter(index, 5000, [-0.1, -0.1, 0.3, 0.3])).toBeNull();
  });

  it("ignores changes outside the viewport", () => {
    expect(nextChangeAfter(index, 0, [2.0, 1.0, 2.2, 1.2])).toBeNull();
  });

  it("agrees with a brute-force scan over random queries", () => {
    for (let i = 0; i < 200; i++) {
      const year = Math.round(Math.random() * 1200 - 100);
      const x = Math.random() * 4 - 2;
      const y = Math.random() * 2 - 1;
      const box: [number, number, number, number] = [x, y, x + 0.5, y + 0.5];
      expect(nextChangeAfter(index, year, box)).toBe(
        nextChangeBruteForce(versions, geometry, S, year, box),
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/pipeline/tests/change-index.test.ts`
Expected: FAIL — cannot resolve `../src/stages/change-index`.

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/change-index.ts`:

```typescript
import {
  type ChangesArtifact,
  GRID,
  SCHEMA_VERSION,
  type Polygon,
  type Version,
  type VersionGeometry,
  WORLD_HALF_HEIGHT,
  WORLD_HALF_WIDTH,
} from "@history/model";

const BOUNDS: [number, number, number, number] = [
  -WORLD_HALF_WIDTH,
  -WORLD_HALF_HEIGHT,
  WORLD_HALF_WIDTH,
  WORLD_HALF_HEIGHT,
];

/** Bounding box of one polygon, in the same scaled integers as its rings. */
export function polygonBbox(polygon: Polygon): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const ring of polygon) {
    for (let i = 0; i < ring.length; i += 2) {
      const x = ring[i] as number;
      const y = ring[i + 1] as number;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Inclusive cell range covering an unscaled-projected bbox. */
function cellRange(bbox: [number, number, number, number]) {
  const [minX, minY, maxX, maxY] = BOUNDS;
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    x0: clamp(Math.floor(((bbox[0] - minX) / w) * GRID.cols), 0, GRID.cols - 1),
    x1: clamp(Math.floor(((bbox[2] - minX) / w) * GRID.cols), 0, GRID.cols - 1),
    y0: clamp(Math.floor(((bbox[1] - minY) / h) * GRID.rows), 0, GRID.rows - 1),
    y1: clamp(Math.floor(((bbox[3] - minY) / h) * GRID.rows), 0, GRID.rows - 1),
  };
}

/**
 * Build the change-year index.
 *
 * Each POLYGON is bucketed by its own bounding box rather than the version's.
 * Measured on the real dataset, a single version's bbox can claim 72% of the
 * map while its individual polygons claim 10% -- see
 * docs/decisions/0013-index-buckets-polygons.md.
 *
 * A polygon's bounding box is still not the polygon, so a query can report a
 * change just outside the visible shape. That is a documented property: the
 * failure mode is a brief pause for something slightly off-screen, which shows
 * more than necessary rather than skipping something real.
 */
export function buildChangeIndex(
  versions: Version[],
  geometry: Record<string, VersionGeometry>,
  coordScale: number,
): ChangesArtifact {
  const cells: Array<Set<number>> = Array.from(
    { length: GRID.cols * GRID.rows },
    () => new Set<number>(),
  );

  for (const version of versions) {
    const g = geometry[version.id];
    if (!g) continue;
    for (const polygon of g.polygons) {
      const bb = polygonBbox(polygon);
      const { x0, x1, y0, y1 } = cellRange([
        bb[0] / coordScale,
        bb[1] / coordScale,
        bb[2] / coordScale,
        bb[3] / coordScale,
      ]);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cell = cells[y * GRID.cols + x] as Set<number>;
          cell.add(version.fromYear);
          cell.add(version.toYear);
        }
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    grid: { cols: GRID.cols, rows: GRID.rows, bounds: BOUNDS },
    cells: cells.map((set) => [...set].sort((a, b) => a - b)),
  };
}

/**
 * The query backing decision 0006's nextVisibleChange. `bbox` is in unscaled
 * projected units.
 */
export function nextChangeAfter(
  index: ChangesArtifact,
  year: number,
  bbox: [number, number, number, number],
): number | null {
  const { x0, x1, y0, y1 } = cellRange(bbox);
  let best: number | null = null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const cell = index.cells[y * index.grid.cols + x];
      if (!cell) continue;
      for (const candidate of cell) {
        if (candidate <= year) continue;
        if (best === null || candidate < best) best = candidate;
        break; // cells are sorted, so the first year past `year` is the best here
      }
    }
  }
  return best;
}

/**
 * The same question answered by scanning every polygon. Exists so the
 * acceptance criterion can compare the two. It must use the SAME
 * polygon-bounding-box predicate as the index, or the comparison would be
 * testing the predicate rather than the index.
 */
export function nextChangeBruteForce(
  versions: Version[],
  geometry: Record<string, VersionGeometry>,
  coordScale: number,
  year: number,
  bbox: [number, number, number, number],
): number | null {
  const { x0, x1, y0, y1 } = cellRange(bbox);
  let best: number | null = null;
  for (const version of versions) {
    const g = geometry[version.id];
    if (!g) continue;
    let overlaps = false;
    for (const polygon of g.polygons) {
      const bb = polygonBbox(polygon);
      const r = cellRange([
        bb[0] / coordScale,
        bb[1] / coordScale,
        bb[2] / coordScale,
        bb[3] / coordScale,
      ]);
      if (r.x0 <= x1 && r.x1 >= x0 && r.y0 <= y1 && r.y1 >= y0) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) continue;
    for (const candidate of [version.fromYear, version.toYear]) {
      if (candidate > year && (best === null || candidate < best)) best = candidate;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run the test and the gates**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/pipeline/tests/change-index.test.ts && pnpm lint && pnpm typecheck`
Expected: PASS, 9 tests, both gates exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): spatially bucketed change-year index"
```

---

### Task 4: Emit three levels and the index

The integration task. Simplification runs **inline inside `build`**, not as a separate cached command.

> **Deviation from the spec, stated deliberately.** `docs/phase-1-milestone-2-design.md` proposed `pipeline simplify` as a separate cached command following the pattern Milestone 1 used for `fetch`. That pattern fits `fetch` because it is slow *and* impure. Simplification is neither: it is deterministic, and it needs projected geometry that only `build` produces — so a separate command either duplicates the whole pipeline or creates a chicken-and-egg dependency where `build` needs `simplify`'s output and `simplify` needs `build`'s. It would also force a second committed tree under `fixtures/` for `fixture:bless` to work. Inline avoids all three. Task 1's timing probe is the evidence: if a full run proves slow enough to be painful, caching can be added later as a measured decision rather than an assumed one.

**Files:**
- Modify: `packages/model/src/canon.ts`, `packages/pipeline/src/stages/emit.ts`, `packages/pipeline/src/build.ts`, `packages/pipeline/src/cli.ts`, root `package.json`
- Test: `packages/pipeline/tests/emit.test.ts`, `packages/pipeline/tests/build.test.ts` (extend both)

**Interfaces:**
- Consumes: `simplifyPolygonGroups` (Task 1), `buildChangeIndex` (Task 3), `GRID`/`PX_PER_UNIT` (Task 2).
- Produces: `EmitInput` gains `geometry: { coarse; mid; full }` (each `Record<string, VersionGeometry>`) and `changes: ChangesArtifact`, replacing the single `geometry` field. `BuildReport` gains `levels: Record<"coarse" | "mid", { vertices: number; percent: number }>`.

- [ ] **Step 1: Measure, then choose the simplification percentages**

Do not guess these. Write a scratch probe under `.superpowers/` (git-ignored), run it with `pnpm exec tsx`, then delete it. It must load `dist/versions.2.json`, and for each candidate percentage in `[1, 2, 5, 10, 20, 30]` run `simplifyPolygonGroups` over **all** versions, re-quantise to the level's scale, serialise a `VersionsArtifact`, and report raw and gzipped size plus total vertex count. Relative imports from that directory are `../../../packages/...`; `readFileSync` paths are relative to the repo root.

Choose:
- **coarse** — the *least* aggressive percentage whose gzipped size is comfortably under 8 MB. The project owner has said fidelity matters more than size and that around 4 MB would be fine, so do not simplify harder than the budget requires.
- **mid** — roughly midway in vertex count between coarse and full.

Report the full table, not just the two chosen values.

- [ ] **Step 2: Record the chosen percentages**

Append to `packages/model/src/canon.ts`, filling in the measured values and the real numbers from Step 1:

```typescript
/**
 * Visvalingam vertex-retention percentage per level, passed to mapshaper.
 *
 * Chosen by measurement, not by feel: see the table in the Milestone 2 plan.
 * The rule is the LEAST aggressive simplification that meets the budget, since
 * the 8 MB gzipped ceiling applies only to the coarsest artifact and fidelity
 * matters more than bytes here. `full` is 100 because it is not simplified.
 */
export const SIMPLIFY_PERCENT = {
  coarse: 0, // replace with the measured value
  mid: 0, // replace with the measured value
  full: 100,
} as const;
```

- [ ] **Step 3: Update `EmitInput` and write the new artifacts**

In `packages/pipeline/src/stages/emit.ts`, replace the single `geometry` field with per-level geometry and add `changes`:

```typescript
export interface EmitInput {
  outDir: string;
  polities: Polity[];
  versions: Version[];
  geometry: {
    coarse: Record<string, VersionGeometry>;
    mid: Record<string, VersionGeometry>;
    full: Record<string, VersionGeometry>;
  };
  changes: ChangesArtifact;
  land: { coarse: Polygon[]; mid: Polygon[] };
  sources: SourceSpec[];
}
```

Build one `VersionsArtifact` per level, each with its own `level` and `coordScale` from `COORD_SCALE`, all sharing the same `rows`. Write them as `versions.0.json` (coarse), `versions.1.json` (mid) and `versions.2.json` (full), plus `changes.json`, all through `writeArtifact`. Then replace the manifest's file list with the sorted seven:

```typescript
  const files = [
    "changes.json",
    "land.0.json",
    "land.1.json",
    "polities.json",
    "versions.0.json",
    "versions.1.json",
    "versions.2.json",
  ];
```

- [ ] **Step 4: Wire `build.ts`**

After the existing projection loop produces full-detail `geometry`, simplify to the two coarser levels and build the index. The index is built from **full-detail** geometry, since it is the most accurate source for bounding boxes and the artifact is level-independent.

```typescript
  // Simplify once per coarser level, from full detail rather than cascading, so
  // error does not compound. All versions go through one mapshaper call per
  // level -- see stages/simplify.ts for why that must not be split up.
  const groups = versions.map((v) => ({
    id: v.id,
    polygons: (geometry[v.id] as VersionGeometry).polygons,
  }));

  const levels: Record<"coarse" | "mid", Record<string, VersionGeometry>> = {
    coarse: {},
    mid: {},
  };
  const levelStats: BuildReport["levels"] = {
    coarse: { vertices: 0, percent: SIMPLIFY_PERCENT.coarse },
    mid: { vertices: 0, percent: SIMPLIFY_PERCENT.mid },
  };

  for (const level of ["coarse", "mid"] as const) {
    const simplified = await simplifyPolygonGroups(groups, SIMPLIFY_PERCENT[level]);
    const scale = COORD_SCALE[level];
    for (const version of versions) {
      const source = geometry[version.id] as VersionGeometry;
      const polygons = (simplified.get(version.id) ?? source.polygons).map((polygon) =>
        polygon.map((ring) => {
          const out: number[] = new Array(ring.length);
          for (let i = 0; i < ring.length; i++) {
            out[i] = Math.round(((ring[i] as number) / COORD_SCALE.full) * scale);
          }
          return out;
        }),
      );
      for (const polygon of polygons) for (const ring of polygon) levelStats[level].vertices += ring.length / 2;
      const rescale = (v: number) => Math.round((v / COORD_SCALE.full) * scale);
      levels[level][version.id] = {
        polygons,
        bbox: source.bbox.map(rescale) as [number, number, number, number],
        anchor: source.anchor.map(rescale) as [number, number],
      };
    }
  }

  const changes = buildChangeIndex(versions, geometry, COORD_SCALE.full);
```

`build` becomes `async` because `simplifyPolygonGroups` is. Update `runBuild` in `cli.ts` to `await` it, and make the `build` command branch `async`. Extend `BuildReport` with the `levels` field and print it:

```typescript
  console.log(
    `  Levels: coarse ${report.levels.coarse.vertices.toLocaleString()} vertices ` +
      `at ${report.levels.coarse.percent}%, mid ${report.levels.mid.vertices.toLocaleString()} ` +
      `at ${report.levels.mid.percent}%.`,
  );
```

- [ ] **Step 5: Extend the existing tests**

In `packages/pipeline/tests/emit.test.ts`, update the `input()` helper to the new `geometry` shape (the same geometry object for all three levels is fine) and add a minimal `changes` value. Update the artifact-list assertion to the seven files. Add:

```typescript
  it("writes one versions artifact per level, each stamped with its own scale", () => {
    emit(input(dir));
    for (const [file, level, scale] of [
      ["versions.0.json", "coarse", COORD_SCALE.coarse],
      ["versions.1.json", "mid", COORD_SCALE.mid],
      ["versions.2.json", "full", COORD_SCALE.full],
    ] as const) {
      const artifact = readArtifact<VersionsArtifact>(join(dir, file));
      expect(artifact.level).toBe(level);
      expect(artifact.coordScale).toBe(scale);
      expect(artifact.rows).toHaveLength(1);
    }
  });
```

In `packages/pipeline/tests/build.test.ts`, `await` the `build` calls and add:

```typescript
  it("emits all three levels and a change index", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    for (const f of ["versions.0.json", "versions.1.json", "versions.2.json", "changes.json"]) {
      expect(readFileSync(join(outDir, f), "utf8").length).toBeGreaterThan(0);
    }
    const changes = readArtifact<ChangesArtifact>(join(outDir, "changes.json"));
    expect(changes.cells).toHaveLength(changes.grid.cols * changes.grid.rows);
    expect(changes.cells.flat().length).toBeGreaterThan(0);
  });

  it("simplifies coarser levels without losing any version", async () => {
    await build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const full = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    const coarse = readArtifact<VersionsArtifact>(join(outDir, "versions.0.json"));
    expect(Object.keys(coarse.geometry).sort()).toEqual(Object.keys(full.geometry).sort());
    for (const g of Object.values(coarse.geometry)) expect(g.polygons.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 6: Add the script and run the real build**

Root `package.json` needs no new script for simplify (it is inline), but confirm `build` still reads:

```json
"build": "NODE_OPTIONS=--max-old-space-size=8192 tsx packages/pipeline/src/cli.ts build"
```

Then:

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm test && pnpm lint && pnpm typecheck
pnpm build
ls -la dist/
for f in dist/*.json; do printf "%-20s raw %10s  gz %10s\n" "$(basename $f)" "$(wc -c < $f)" "$(gzip -9 -c $f | wc -c)"; done
```

Report the full size table and the build's printed report. `versions.0.json` gzipped must be under 8 MB.

- [ ] **Step 7: Commit**

```bash
git add packages/model packages/pipeline package.json
git commit -m "feat(pipeline): emit three detail levels and the change index"
```

---

### Task 5: The three remaining acceptance criteria

Each test is named after the criterion it enforces, per `docs/standards.md`. Two of the existing geometry criteria must also be widened to the new levels — the whole-branch review of Milestone 1 found a Critical bug that lived precisely in an artifact no criterion covered, so do not leave `versions.0` and `versions.1` unchecked.

**Files:**
- Modify: `packages/pipeline/tests/acceptance.test.ts`, `.github/workflows/full-build.yml`, root `package.json`
- Regenerate: `fixtures/dist/`

**Interfaces:**
- Consumes: `nextChangeAfter`, `nextChangeBruteForce`, `polygonBbox` (Task 3), `PX_PER_UNIT`, `COORD_SCALE` (Task 2).
- Produces: nothing consumed later.

- [ ] **Step 1: Widen the existing geometry criteria**

The suite's `allPolygonGroups()` helper currently gathers versions plus both land levels. Extend it to include `versions.0.json` and `versions.1.json`, so ring validity, the un-projection round-trip and the antimeridian check all cover every emitted artifact. Each level must be un-projected using **its own** `coordScale`, not the full-detail one.

- [ ] **Step 2: Write the no-new-gaps criterion**

```typescript
describe("simplification", () => {
  it("no pair of previously-adjacent polygons has gained a gap wider than one screen pixel", () => {
    // Two layers. Shared topology permits the strong form: mapshaper keeps a
    // shared arc identical on both sides, so a vertex dropped from one border
    // is dropped from the other. Layer 1 asserts that. Layer 2 is the criterion
    // as literally stated, in pixels, against the provisional PX_PER_UNIT
    // figures.
    //
    // If layer 1 fails, report it -- do not weaken it. It failing means
    // topology was not preserved, which is the exact defect this criterion
    // exists to catch, and the pixel layer would likely pass anyway.
    const full = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));

    for (const [file, level] of [
      ["versions.0.json", "coarse"],
      ["versions.1.json", "mid"],
    ] as const) {
      const simplified = readArtifact<VersionsArtifact>(join(outDir, file));
      const scale = COORD_SCALE[level];

      // Exact full-detail vertex -> the versions that use it.
      const sharedAtFull = new Map<string, string[]>();
      for (const [id, g] of Object.entries(full.geometry)) {
        for (const polygon of g.polygons) {
          for (const ring of polygon) {
            for (let i = 0; i < ring.length; i += 2) {
              const key = `${ring[i]},${ring[i + 1]}`;
              const users = sharedAtFull.get(key);
              if (users) {
                if (users[users.length - 1] !== id) users.push(id);
              } else sharedAtFull.set(key, [id]);
            }
          }
        }
      }

      // Vertex positions each version retains at this level.
      const retained = new Map<string, Set<string>>();
      for (const [id, g] of Object.entries(simplified.geometry)) {
        const set = new Set<string>();
        for (const polygon of g.polygons) {
          for (const ring of polygon) {
            for (let i = 0; i < ring.length; i += 2) set.add(`${ring[i]},${ring[i + 1]}`);
          }
        }
        retained.set(id, set);
      }

      // Layer 1: a shared position is kept by all its neighbours or by none.
      let asymmetric = 0;
      for (const [key, ids] of sharedAtFull) {
        if (ids.length < 2) continue;
        const parts = key.split(",");
        const kx = Math.round((Number(parts[0]) / COORD_SCALE.full) * scale);
        const ky = Math.round((Number(parts[1]) / COORD_SCALE.full) * scale);
        const k = `${kx},${ky}`;
        const keepers = ids.filter((id) => retained.get(id)?.has(k)).length;
        if (keepers > 0 && keepers < ids.length) asymmetric++;
      }
      expect(asymmetric).toBe(0);
    }
  });
});
```

- [ ] **Step 3: Write the index-equivalence criterion**

```typescript
  it("for 1,000 random (year, bbox) pairs, the next-change lookup matches a brute-force scan", () => {
    // Both sides use the same polygon-bounding-box predicate, so this verifies
    // the index implements its own definition. It cannot detect the
    // bbox-versus-geometry imprecision, which is a documented property of the
    // design rather than a defect -- see the Milestone 2 design doc.
    const full = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    const changes = readArtifact<ChangesArtifact>(join(outDir, "changes.json"));
    const [minX, minY, maxX, maxY] = changes.grid.bounds;

    let seed = 20260904;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 1000; i++) {
      const year = Math.round(minYear + rand() * (maxYear - minYear));
      const w = (maxX - minX) * (0.02 + rand() * 0.3);
      const h = (maxY - minY) * (0.02 + rand() * 0.3);
      const x = minX + rand() * (maxX - minX - w);
      const y = minY + rand() * (maxY - minY - h);
      const box: [number, number, number, number] = [x, y, x + w, y + h];
      expect(nextChangeAfter(changes, year, box)).toBe(
        nextChangeBruteForce(full.rows, full.geometry, full.coordScale, year, box),
      );
    }
  });
```

Define `minYear` and `maxYear` in the enclosing scope from `full.rows` — `Math.min(...rows.map(r => r.fromYear))` and the matching max over `toYear`. The seeded generator keeps the test deterministic; a random-seeded one would make failures unreproducible.

- [ ] **Step 4: Write the budget criterion**

```typescript
  it("the coarsest global artifact is under 8 MB gzipped", () => {
    const manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
    const coarse = manifest.artifacts.find((a) => a.file === "versions.0.json");
    expect(coarse).toBeDefined();
    expect((coarse as ManifestArtifact).gzipBytes).toBeLessThan(8 * 1024 * 1024);
  });
```

Note this runs against the **fixture** build, where it passes trivially. The real check is the full-dataset one in Step 6.

- [ ] **Step 5: Re-bless the goldens and run everything**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm fixture:bless
git diff --stat fixtures/dist/
pnpm test && pnpm lint && pnpm typecheck
```

`fixtures/dist/` gains `versions.0.json`, `versions.1.json` and `changes.json`. **Read the diff before committing it.** A golden artifact blessed with a bug in it pins the bug — that is exactly how Milestone 1's Antarctica defect survived several commits. Report the new per-file sizes and the committed total.

- [ ] **Step 6: Make the CI budget check assert rather than print**

`.github/workflows/full-build.yml` currently prints artifact sizes in a step that can never fail. Replace that step's script so it reads `dist/manifest.json`, prints every artifact's raw and gzipped size, and exits non-zero if `versions.0.json`'s `gzipBytes` is at or above 8 MB. Keep the printing — the trend is useful — but make the assertion real.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline fixtures .github
git commit -m "test: simplification, index and budget acceptance criteria"
```

---

### Task 6: Regions and the playback-density histogram

Restores a capability deleted with the Phase 0 spike. `docs/phase-0-findings.md` asks for this before Phase 2 UX work, because decision 0006's adaptive speed could be a garnish or the dominant mechanic and only measurement distinguishes them.

**Files:**
- Create: `packages/pipeline/src/regions.ts`, `packages/pipeline/src/stages/histogram.ts`, `packages/pipeline/tests/histogram.test.ts`
- Modify: `packages/pipeline/src/cli.ts`, root `package.json`

**Interfaces:**
- Consumes: `equalEarth` from `@history/model`, `nextChangeAfter` is **not** used here — the histogram reads change years directly.
- Produces: `REGIONS`, `ERAS`, `resolveRegion(name)`, `resolveEra(name)`, `projectedBoundsOf(bbox, samples?)`, and `analyse(changes, bbox, from, to, bucket, speed, deadtime): HistogramResult`.

- [ ] **Step 1: Write the region presets**

`packages/pipeline/src/regions.ts` restores the Phase 0 bounding boxes verbatim so results stay comparable to that baseline. Bounding boxes are `[minLon, minLat, maxLon, maxLat]` and none crosses the antimeridian — keep it that way if you add more.

```typescript
export const REGIONS = {
  mediterranean: { label: "Mediterranean", bbox: [-10, 25, 45, 50] },
  subsaharan: { label: "Sub-Saharan Africa", bbox: [-18, -35, 52, 15] },
  seasia: { label: "Southeast Asia", bbox: [92, -11, 141, 29] },
  world: { label: "World", bbox: [-180, -90, 180, 90] },
} as const satisfies Record<string, { label: string; bbox: [number, number, number, number] }>;

export const ERAS = {
  classical: { label: "Classical", from: -200, to: 500 },
  mongol: { label: "Mongol", from: 1200, to: 1400 },
  earlymodern: { label: "Early modern", from: 1500, to: 1900 },
  all: { label: "All", from: -3400, to: 2024 },
} as const satisfies Record<string, { label: string; from: number; to: number }>;
```

Plus `resolveRegion` and `resolveEra` that throw a message listing the known keys.

- [ ] **Step 2: Write the failing test**

`packages/pipeline/tests/histogram.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { accelerationProfile, projectedBoundsOf } from "../src/stages/histogram";
import { resolveEra, resolveRegion } from "../src/regions";

describe("projectedBoundsOf", () => {
  it("samples along the edges, because Equal Earth curves", () => {
    // Projecting only the four corners understates a wide box's extent: the
    // top and bottom edges bow. A sampled bound must be at least as wide as a
    // corners-only one.
    const sampled = projectedBoundsOf([-180, -90, 180, 90]);
    expect(sampled[2] - sampled[0]).toBeGreaterThan(5.4);
    expect(sampled[3] - sampled[1]).toBeGreaterThan(2.6);
  });

  it("bounds a small box tightly", () => {
    const b = projectedBoundsOf([0, 0, 1, 1]);
    expect(b[2] - b[0]).toBeLessThan(0.05);
  });
});

describe("accelerationProfile", () => {
  it("reports nothing accelerated when changes are denser than the ceiling", () => {
    const years = [0, 10, 20, 30, 40];
    const p = accelerationProfile(years, 0, 40, 4, 7);
    expect(p?.fraction).toBe(0);
  });

  it("counts only the years beyond what D seconds covers", () => {
    // At 4 years/second with a 7-second ceiling, 28 years are coverable; a
    // 128-year gap therefore contributes 100 accelerated years.
    const p = accelerationProfile([0, 128], 0, 128, 4, 7);
    expect(p?.acceleratedGaps).toBe(1);
    expect(p?.fraction).toBeCloseTo(100 / 128, 6);
  });

  it("returns null when there is nothing to profile", () => {
    expect(accelerationProfile([], 0, 100, 4, 7)).toBeNull();
  });
});

describe("resolveRegion / resolveEra", () => {
  it("returns the Phase 0 bounding boxes unchanged, so results stay comparable", () => {
    expect(resolveRegion("mediterranean").bbox).toEqual([-10, 25, 45, 50]);
    expect(resolveEra("classical")).toMatchObject({ from: -200, to: 500 });
  });

  it("names the known keys when given an unknown one", () => {
    expect(() => resolveRegion("atlantis")).toThrow(/mediterranean/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then implement**

Run: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use; pnpm vitest run packages/pipeline/tests/histogram.test.ts`
Expected: FAIL — modules do not resolve.

`packages/pipeline/src/stages/histogram.ts` provides:

- `projectedBoundsOf(bbox, samples = 64)` — projects points sampled along all four edges, not just the corners. Equal Earth curves, so a corners-only bound understates a wide box. This is ported from the Phase 0 spike's `extract.mjs`.
- `accelerationProfile(changeYears, from, to, baseSpeed, deadTimeSeconds)` — returns `null` when there is nothing to profile, otherwise `{ fraction, acceleratedGaps, totalGaps, longestGap, longestGapSeconds, thresholdYears }`. At `baseSpeed` years per second a gap of G years takes G/baseSpeed seconds, so any gap longer than `deadTimeSeconds * baseSpeed` must be compressed, and it contributes `gap - threshold` accelerated years.
- `analyse(changes, bbox, from, to, bucket, speed, deadtime)` — converts the lon/lat bbox with `projectedBoundsOf`, collects the distinct change years from every grid cell that bounding box overlaps, buckets them, and returns the per-bucket counts plus the acceleration profile.

- [ ] **Step 4: Add the CLI subcommand**

`pipeline histogram` reads `dist/` (override with `--dist`), defaults to all four regions when `--region` is absent, and accepts `--region`, `--era`, `--bbox=minLon,minLat,maxLon,maxLat`, `--from`, `--to`, `--bucket` (default 100), `--speed` (default 4), `--deadtime` (default 7) and `--out`. Print an ASCII bar chart of distinct change years per bucket and the acceleration summary, matching the Phase 0 output closely enough to compare against.

Add to root `package.json`:

```json
"histogram": "tsx packages/pipeline/src/cli.ts histogram"
```

- [ ] **Step 5: Run it for real and report the numbers**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm histogram --era=all
```

**Report the acceleration fraction for all four regions.** This is the number Phase 0 asked for and nobody has yet seen: below roughly 20% adaptive speed is a garnish, above roughly 60% it is the dominant mechanic and Phase 2's design should reflect that.

- [ ] **Step 6: Commit**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm test && pnpm lint && pnpm typecheck
LC_ALL=C grep -n '[^ -~]' packages/pipeline/src/regions.ts packages/pipeline/src/stages/histogram.ts packages/pipeline/tests/histogram.test.ts
git add packages/pipeline package.json
git commit -m "feat(pipeline): playback-density histogram and region presets"
```

---

### Task 7: Documentation, decision record, and closing Phase 1

**Files:**
- Create: `docs/decisions/0013-index-buckets-polygons.md`
- Modify: `docs/architecture.md`, `packages/model/README.md`, `packages/pipeline/README.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Write decision record 0013**

Records 0001-0012 exist, so 0013 is next. Read two existing records first to match the house style: `**Status:** accepted` under the title, then **Context**, **Decision**, **Consequences**, roughly 15-25 lines, ASCII only with plain hyphens.

It must record that the change index buckets **polygons, not versions**, and carry the measurements that justify it, because without them this reads like needless complication and a future contributor would reasonably simplify it back:

- indexing by version bounding box, one version's box claims 1,479 of 2,048 cells (72% of the map); by polygon, the worst is 207 (10%)
- index entries fall from 1,682,966 to 471,954, about 70% smaller
- after deduplication the artifact is 33 KB gzipped at 64x32, so grid size was chosen for query precision rather than bytes

State the accepted cost honestly: a polygon's bounding box is still not the polygon, so a query can report a change just off-screen. The failure mode shows more than necessary rather than skipping something real.

- [ ] **Step 2: Update the architecture guide**

`docs/architecture.md` describes the stages end to end. Add simplification and the index, and be accurate about three things the reviews of Milestone 1 established:

- simplification is topology-preserving and depends on Cliopatria sharing 74.6% of its distinct vertex positions between polities — that finding is why the approach works at all
- the antimeridian stage remains exercised only by synthetic tests, since no Cliopatria polygon wraps
- determinism is scoped to the pinned toolchain, and mapshaper is now part of that toolchain

- [ ] **Step 3: Update the package READMEs and the root README**

`packages/pipeline/README.md` gains the `histogram` subcommand with its flags. `packages/model/README.md` gains `ChangesArtifact`, `GRID`, `PX_PER_UNIT` (noting it is provisional) and `SIMPLIFY_PERCENT`. The root `README.md` artifact list gains `versions.0.json`, `versions.1.json` and `changes.json`, with real sizes from the Task 4 build.

- [ ] **Step 4: Update CLAUDE.md's "Current state"**

Keep it short — it loads every session and length dilutes it. It should say Phase 1 is complete, name what the pipeline produces, and point at `docs/architecture.md`. Remove the "Milestone 2 is next" line.

- [ ] **Step 5: Final verification and commit**

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build
LC_ALL=C grep -rn '[^ -~]' docs/decisions/0013-index-buckets-polygons.md docs/architecture.md packages/model/README.md packages/pipeline/README.md
git add -A
git commit -m "docs: index decision record, architecture and READMEs for Milestone 2"
```

The grep must print nothing.

---

## Definition of done

- `pnpm fetch:sources && pnpm build` produces `dist/` with all eight artifacts: `polities.json`, `versions.0/1/2.json`, `land.0/1.json`, `changes.json` and `manifest.json`.
- `versions.0.json` is under 8 MB gzipped, asserted by a test and by CI rather than printed.
- All Phase 1 acceptance criteria in `docs/phase-1-importer.md` map to a named passing test.
- Two consecutive builds are byte-identical, mapshaper included.
- `pnpm histogram` reports the acceleration fraction for all four Phase 0 regions.
- Decision record 0013 exists; `docs/architecture.md`, both package READMEs and CLAUDE.md describe the finished pipeline.
- `pnpm lint`, `pnpm typecheck` and `pnpm test` are clean; CI is green.
