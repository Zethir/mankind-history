# Phase 1, Milestone 1 — the data spine vertical slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pinned Cliopatria and Natural Earth downloads into a validated, deterministic, render-ready `dist/` artifact set at full geometric detail, with every Milestone 1 acceptance criterion covered by a named test.

**Architecture:** A pnpm workspace with two packages. `@history/model` owns the canonical types, the Equal Earth projection (forward and inverse), and the deterministic artifact read/write contract — it has no runtime dependencies and is the only thing the future viewer imports. `@history/pipeline` owns a checksum-pinning downloader and an in-process pipeline of pure stage functions (normalise → resolve identity → derive lineage → project → emit) composed by one `build` command. Network fetch is a separate cached command so the fast pure pipeline can be iterated on cheaply.

**Tech Stack:** TypeScript 5 (`strict`), Node 22 (ESM), pnpm workspaces, Vitest, Biome, tsx, polylabel.

**Spec:** `docs/phase-1-design.md` (implementation design) and `docs/phase-1-importer.md` (canonical phase spec — the output contract and acceptance criteria). Read both.

## Global Constraints

- **Node 22**, pinned in `.nvmrc`. `engines.node` is `>=22`.
- **TypeScript `strict: true`.** ESM only. No CommonJS.
- **Biome** for lint and format. One config at the repo root, no per-editor overrides.
- **Vitest.** Every acceptance criterion in `docs/phase-1-importer.md` is a test, named after the criterion it enforces.
- **Validation failures fail the build.** Never warn and continue.
- **Builds are deterministic.** Same inputs produce byte-identical outputs. No wall-clock timestamps in any `dist/` file.
- **Never invent geometry.** No interpolation, no morphing, no clipping that creates a border that never existed. The one sanctioned geometry split is antimeridian cutting (Task 11), which gets its own decision record.
- **`confidence` stays `null`** for every version. It has no licensed source (decision 0005). Do not populate it.
- **`RELATION` rows are dropped** and the drop count reported (decision 0008).
- **Scripts take explicit `--input` / `--out` paths.** No implicit working-directory magic.
- **Coordinates are scaled integers.** Scale per detail level lives in `packages/model/src/canon.ts`. `full` is `1e8`.
- **Licence: MIT.** Attribution for Cliopatria (CC-BY) ships in `manifest.json`.
- Commit after every task. Conventional-commit prefixes (`feat:`, `test:`, `docs:`, `chore:`).

## File Structure

**Repo root**
- `package.json` — workspace root: scripts, devDependencies
- `pnpm-workspace.yaml` — declares `packages/*`
- `.nvmrc` — `22`
- `tsconfig.base.json` — shared strict compiler options
- `biome.json` — lint + format config
- `vitest.config.ts` — workspace test config
- `.editorconfig`, `.gitignore`, `LICENSE`

**`packages/model/`** (`@history/model`, zero runtime dependencies)
- `src/types.ts` — `Polity`, `Version`, artifact shapes, `Manifest`. Types only, no logic.
- `src/canon.ts` — every shared constant: schema version, projection id, per-level coordinate scales, the antimeridian segment threshold.
- `src/normalize-name.ts` — the one `normalizeName` rule, used for polity ids.
- `src/projection.ts` — Equal Earth forward and iterative inverse. Pure maths, no I/O.
- `src/artifact.ts` — deterministic JSON writer and typed reader.
- `src/index.ts` — barrel re-export.

**`packages/pipeline/`** (`@history/pipeline`, depends on `@history/model`)
- `src/sources.ts` — the pinned source manifest: URLs, upstream versions, licences, checksums.
- `src/fetch/download.ts` — download, SHA-256 verify, unzip.
- `src/stages/normalise.ts` — raw GeoJSON to `NormalisedRow[]`, with drop counts.
- `src/stages/identity.ts` — rows to polities, alias application.
- `src/stages/lineage.ts` — `prevId` / `delta` / `gap`, duplicate and overlap detection.
- `src/stages/antimeridian.ts` — ring unwrapping and band clipping. Lon/lat space only.
- `src/stages/project.ts` — Equal Earth projection, bbox, label anchor, integer scaling.
- `src/stages/emit.ts` — artifact writing and manifest assembly.
- `src/build.ts` — composes the stages in memory.
- `src/cli.ts` — `fetch` | `build` | `extract-fixture` argument parsing.
- `aliases.json`, `overlaps.json` — hand-maintained, committed.
- `tests/` — one file per acceptance criterion, named after it.

**`fixtures/`** — committed real slice plus golden `dist/` output.

**`docs/decisions/`** — two new records, written in the task that implements them.

Each stage is a pure function taking data and returning data. Only `fetch/download.ts`, `stages/emit.ts` and `cli.ts` touch the filesystem or the network. That boundary is what makes the acceptance criteria testable without fixtures on disk.

---

### Task 1: Workspace scaffolding

Establishes the pnpm workspace, the toolchain and the licence. Nothing here is testable behaviour, so the deliverable is that `pnpm install`, `pnpm lint`, `pnpm typecheck` and `pnpm test` all run clean on an empty workspace.

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`, `.editorconfig`, `LICENSE`
- Create: `packages/model/package.json`, `packages/model/tsconfig.json`, `packages/model/src/index.ts`
- Create: `packages/pipeline/package.json`, `packages/pipeline/tsconfig.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: the `@history/model` and `@history/pipeline` package names, the `pnpm lint` / `pnpm typecheck` / `pnpm test` scripts, and `tsconfig.base.json` for later packages to extend.

- [ ] **Step 1: Pin the Node version and confirm the toolchain**

```bash
echo "22" > .nvmrc
nvm install && nvm use
node --version   # must print v22.x
pnpm --version   # must print 10.x
```

If `nvm` is not installed: `brew install nvm` and follow its post-install shell setup, then re-run.

- [ ] **Step 2: Write the workspace root files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

`package.json`:

```json
{
  "name": "mankind-history",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.22.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "tsc -p packages/model && tsc -p packages/pipeline",
    "test": "vitest run --passWithNoTests",
    "fetch": "tsx packages/pipeline/src/cli.ts fetch",
    "build": "tsx packages/pipeline/src/cli.ts build",
    "extract-fixture": "tsx packages/pipeline/src/cli.ts extract-fixture"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.0",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "noEmit": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.0/schema.json",
  "files": { "includes": ["**", "!**/node_modules", "!dist", "!data", "!fixtures/dist"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

`vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    environment: "node",
  },
});
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 3: Write the MIT licence**

Create `LICENSE` with the standard MIT text, `Copyright (c) 2026 Charlélie Boussaud`. Decision 0005 leaves the code licence a free choice today; `docs/phase-1-design.md` D11 records MIT.

- [ ] **Step 4: Replace `.gitignore`**

```gitignore
node_modules/
dist/
data/*
!data/.gitkeep
coverage/
*.tsbuildinfo
.DS_Store
```

`data/` holds downloads and intermediates and is never committed. `dist/` is build output, released as artifacts rather than committed. `fixtures/` is deliberately NOT ignored — the committed slice and golden output live there.

- [ ] **Step 5: Write the two package skeletons**

`packages/model/package.json`:

```json
{
  "name": "@history/model",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/model/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`packages/model/src/index.ts`:

```typescript
export {};
```

`packages/pipeline/package.json`:

```json
{
  "name": "@history/pipeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@history/model": "workspace:*"
  }
}
```

`packages/pipeline/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 6: Install and verify the toolchain runs clean**

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Expected: install succeeds and links `@history/model` into `packages/pipeline/node_modules`; `lint` passes; `typecheck` prints nothing; `test` reports no test files and exits 0.

If `pnpm lint` reports formatting differences on the JSON files you just wrote, run `pnpm format` and re-run `pnpm lint`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace, TypeScript, Biome, Vitest, MIT licence"
```

---

### Task 2: Canonical types and shared constants

The canonical model from `docs/phase-1-importer.md` becomes actual TypeScript, so a `Version` missing `gap` fails at compile time. Types carry no runtime behaviour, so the deliverable is verified by a compile-time test that fails if a required field is dropped.

**Files:**
- Create: `packages/model/src/types.ts`, `packages/model/src/canon.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Polity`, `Version`, `SourceRef`, `Ring`, `Polygon`, `VersionGeometry`, `LevelName`, `PolitiesArtifact`, `VersionsArtifact`, `LandArtifact`, `ManifestSource`, `ManifestArtifact`, `Manifest`. Constants `SCHEMA_VERSION`, `PROJECTION`, `COORD_SCALE`, `LEVEL_INDEX`, `MAX_SEGMENT_X`, `WORLD_HALF_WIDTH`.

- [ ] **Step 1: Write the failing test**

`packages/model/tests/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { COORD_SCALE, MAX_SEGMENT_X, PROJECTION, SCHEMA_VERSION } from "../src/canon";
import type { Polity, Version } from "../src/types";

describe("canonical types", () => {
  it("a Version carries every lineage field the expansion flash depends on", () => {
    // Decision 0004 requires prevId, delta and gap on every version.
    const version: Version = {
      id: "wd:Q1747689@-27",
      polityId: "wd:Q1747689",
      fromYear: -27,
      toYear: 180,
      area: 4200000,
      prevId: null,
      delta: null,
      gap: null,
      confidence: null,
      source: { dataset: "cliopatria", version: "1.0.0" },
    };
    expect(version.id).toBe("wd:Q1747689@-27");
    expect(version.confidence).toBeNull();
  });

  it("a Polity carries the three reference identifiers decision 0007 stores", () => {
    const polity: Polity = {
      id: "wd:Q1747689",
      name: "Roman Empire",
      normalizedName: "roman-empire",
      wikidata: "Q1747689",
      wikipedia: "Roman_Empire",
      seshat: "12",
    };
    expect(polity.normalizedName).toBe("roman-empire");
  });

  it("pins the constants the artifact contract depends on", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(PROJECTION).toBe("equal-earth");
    expect(COORD_SCALE.full).toBe(1e8);
    expect(COORD_SCALE.mid).toBe(1e6);
    expect(COORD_SCALE.coarse).toBe(1e5);
    expect(MAX_SEGMENT_X).toBe(2.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/model/tests/types.test.ts`
Expected: FAIL — cannot resolve `../src/canon` or `../src/types`.

- [ ] **Step 3: Write `packages/model/src/types.ts`**

```typescript
/** A political entity, stable across upstream re-releases. See decision 0007. */
export interface Polity {
  id: string;
  name: string;
  /** Lowercased, diacritic-stripped slug. The fallback identity key. */
  normalizedName: string;
  /** Reference identifiers for future enrichment joins, not outbound links. */
  wikidata: string | null;
  wikipedia: string | null;
  seshat: string | null;
}

export interface SourceRef {
  dataset: "cliopatria";
  /** The upstream release this row came from. */
  version: string;
}

/** One dated territorial assertion about a polity. */
export interface Version {
  /** `${polityId}@${fromYear}`. Unique — enforced by an acceptance criterion. */
  id: string;
  polityId: string;
  /** Integer, negative for BCE. */
  fromYear: number;
  toYear: number;
  /** Square kilometres, from Cliopatria's equal-area computed Area. */
  area: number;
  /** Derived at build time. Null on first appearance. */
  prevId: string | null;
  delta: number | null;
  gap: number | null;
  /** Always null in Phase 1 — no licensed source. See decision 0005. */
  confidence: number | null;
  source: SourceRef;
}

/** A ring as flat scaled-integer projected coordinates: [x0,y0,x1,y1,...]. */
export type Ring = number[];
/** Outer ring first, holes after. */
export type Polygon = Ring[];

export interface VersionGeometry {
  polygons: Polygon[];
  /** Scaled-integer projected [minX, minY, maxX, maxY]. */
  bbox: [number, number, number, number];
  /** Scaled-integer projected pole of inaccessibility, for label placement. */
  anchor: [number, number];
}

export type LevelName = "coarse" | "mid" | "full";

export interface PolitiesArtifact {
  schemaVersion: number;
  polities: Polity[];
}

export interface VersionsArtifact {
  schemaVersion: number;
  level: LevelName;
  coordScale: number;
  rows: Version[];
  /** Keyed by version id. */
  geometry: Record<string, VersionGeometry>;
}

export interface LandArtifact {
  schemaVersion: number;
  level: LevelName;
  coordScale: number;
  polygons: Polygon[];
}

export interface ManifestSource {
  dataset: string;
  name: string;
  license: string;
  upstreamVersion: string;
  url: string;
  sha256: string;
}

export interface ManifestArtifact {
  file: string;
  bytes: number;
  gzipBytes: number;
  sha256: string;
}

/** Records provenance only. Deliberately carries no wall-clock time. */
export interface Manifest {
  schemaVersion: number;
  projection: "equal-earth";
  sources: ManifestSource[];
  artifacts: ManifestArtifact[];
}
```

- [ ] **Step 4: Write `packages/model/src/canon.ts`**

```typescript
/** Every constant shared between the pipeline and the viewer. One place. */

export const SCHEMA_VERSION = 1;

export const PROJECTION = "equal-earth" as const;

/**
 * Coordinates are stored as `Math.round(projected * scale)`. Integer storage
 * makes precision explicit and determinism true by construction rather than by
 * careful float rounding.
 *
 * `full` is 1e8 because the acceptance criteria require un-projecting a stored
 * coordinate to return the source lon/lat within 1e-6 degrees. The Equal Earth
 * longitude gradient is about 68 degrees per projected unit, so a 1e-8 quantum
 * contributes at most ~3.4e-7 degrees of error — inside the bound with margin.
 */
export const COORD_SCALE = {
  coarse: 1e5,
  mid: 1e6,
  full: 1e8,
} as const;

/** Artifact file suffix per detail level: versions.0.json is coarse. */
export const LEVEL_INDEX = {
  coarse: 0,
  mid: 1,
  full: 2,
} as const;

/** Half the projected world width: x at lon 180, lat 0. */
export const WORLD_HALF_WIDTH = 2.7062;

/**
 * A single segment between consecutive projected vertices wider than this spans
 * more than 180 degrees of longitude, which in this dataset only ever means an
 * uncut antimeridian crossing rather than real geometry.
 */
export const MAX_SEGMENT_X = 2.7;
```

- [ ] **Step 5: Re-export from the barrel**

`packages/model/src/index.ts`:

```typescript
export * from "./canon";
export * from "./types";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/model/tests/types.test.ts && pnpm typecheck`
Expected: PASS, 3 tests. Typecheck silent.

- [ ] **Step 7: Commit**

```bash
git add packages/model
git commit -m "feat(model): canonical types and shared constants"
```

---

### Task 3: The normalised-name rule

Polity identity falls back to a normalised name when a row carries no Wikidata id (decision 0007). The rule has to be pinned and tested, because changing it silently re-keys every polity without a Wikidata id and resets their lineage chains.

**Files:**
- Create: `packages/model/src/normalize-name.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/normalize-name.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeName(name: string): string`.

- [ ] **Step 1: Write the failing test**

`packages/model/tests/normalize-name.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeName } from "../src/normalize-name";

describe("normalizeName", () => {
  it("lowercases and hyphenates words", () => {
    expect(normalizeName("Kingdom of Numidia")).toBe("kingdom-of-numidia");
  });

  it("strips diacritics so accented spellings key identically", () => {
    expect(normalizeName("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(normalizeName("Kingdom of Ayutthayā")).toBe("kingdom-of-ayutthaya");
  });

  it("collapses runs of punctuation and whitespace into a single hyphen", () => {
    expect(normalizeName("  Roman   Empire  ")).toBe("roman-empire");
    expect(normalizeName("Wei (Cao)")).toBe("wei-cao");
    expect(normalizeName("Qin -- Western")).toBe("qin-western");
  });

  it("keeps digits, which appear in dynastic names", () => {
    expect(normalizeName("Dynasty 18")).toBe("dynasty-18");
  });

  it("is idempotent, so re-normalising a normalised name is a no-op", () => {
    const once = normalizeName("Côte d'Ivoire");
    expect(normalizeName(once)).toBe(once);
  });

  it("returns an empty string for input with no alphanumerics", () => {
    expect(normalizeName("---")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/model/tests/normalize-name.test.ts`
Expected: FAIL — cannot resolve `../src/normalize-name`.

- [ ] **Step 3: Write the implementation**

`packages/model/src/normalize-name.ts`:

```typescript
/**
 * The fallback polity identity key (decision 0007). Changing this rule re-keys
 * every polity without a Wikidata id and resets its lineage chain, so it is
 * pinned by tests.
 *
 * NFKD first so combining marks separate from their base letters, then the
 * combining-mark range is stripped, then everything outside [a-z0-9] collapses
 * to a single hyphen.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Re-export and run the test**

Add `export * from "./normalize-name";` to `packages/model/src/index.ts`.

Run: `pnpm vitest run packages/model/tests/normalize-name.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): normalizeName, the fallback polity identity key"
```

---

### Task 4: Equal Earth projection, forward and inverse

Decision 0002 fixes Equal Earth, projected at build time. The forward transform is ported from the Phase 0 spike at `src/lib/projection.mjs`. The inverse is new: Equal Earth has no closed-form inverse, so it needs Newton iteration, and without it the round-trip acceptance criterion cannot be checked at all.

**Files:**
- Create: `packages/model/src/projection.ts`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/projection.test.ts`

**Interfaces:**
- Consumes: `COORD_SCALE` from `../src/canon`.
- Produces: `equalEarth(lon: number, lat: number): [number, number]` and `equalEarthInverse(x: number, y: number): [number, number]`. Both take and return degrees for lon/lat; projected units are dimensionless, roughly x in [-2.71, 2.71] and y in [-1.32, 1.32].

- [ ] **Step 1: Write the failing test**

`packages/model/tests/projection.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { COORD_SCALE } from "../src/canon";
import { equalEarth, equalEarthInverse } from "../src/projection";

/** Shoelace area of a lon/lat box projected with densely sampled edges. */
function projectedArea(minLon: number, minLat: number, maxLon: number, maxLat: number): number {
  const pts: Array<[number, number]> = [];
  const n = 200;
  const lonAt = (t: number) => minLon + (maxLon - minLon) * t;
  const latAt = (t: number) => minLat + (maxLat - minLat) * t;
  for (let i = 0; i <= n; i++) pts.push(equalEarth(lonAt(i / n), minLat));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(maxLon, latAt(i / n)));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(lonAt(1 - i / n), maxLat));
  for (let i = 0; i <= n; i++) pts.push(equalEarth(minLon, latAt(1 - i / n)));
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as [number, number];
    const q = pts[(i + 1) % pts.length] as [number, number];
    acc += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(acc) / 2;
}

describe("equalEarth", () => {
  it("maps the origin to the origin", () => {
    expect(equalEarth(0, 0)).toEqual([0, 0]);
  });

  it("is equal-area: a 2x2 box at 60-62N is cos(61) of the same box at the equator", () => {
    // Decision 0002 records this check. cos(61 degrees) = 0.48481.
    const ratio = projectedArea(0, 60, 2, 62) / projectedArea(0, 0, 2, 2);
    expect(ratio).toBeCloseTo(0.4849, 3);
  });

  it("keeps the world inside the documented projected bounds", () => {
    const [xMax] = equalEarth(180, 0);
    const [, yMax] = equalEarth(0, 90);
    expect(xMax).toBeGreaterThan(2.7);
    expect(xMax).toBeLessThan(2.71);
    expect(yMax).toBeGreaterThan(1.3);
    expect(yMax).toBeLessThan(1.32);
  });
});

describe("equalEarthInverse", () => {
  it("round-trips the unquantised projection to within 1e-9 degrees", () => {
    for (let lon = -180; lon <= 180; lon += 7.5) {
      for (let lat = -90; lat <= 90; lat += 7.5) {
        const [x, y] = equalEarth(lon, lat);
        const [backLon, backLat] = equalEarthInverse(x, y);
        // At the poles every longitude collapses to x = 0, so longitude is
        // not recoverable there. Latitude still is.
        if (Math.abs(lat) < 90) expect(backLon).toBeCloseTo(lon, 9);
        expect(backLat).toBeCloseTo(lat, 9);
      }
    }
  });

  it("round-trips through full-detail integer quantisation within 1e-6 degrees", () => {
    // This is the acceptance criterion from docs/phase-1-importer.md, checked
    // against the actual storage precision rather than raw floats.
    const scale = COORD_SCALE.full;
    for (let lon = -179; lon <= 179; lon += 11) {
      for (let lat = -89; lat <= 89; lat += 11) {
        const [x, y] = equalEarth(lon, lat);
        const qx = Math.round(x * scale) / scale;
        const qy = Math.round(y * scale) / scale;
        const [backLon, backLat] = equalEarthInverse(qx, qy);
        expect(Math.abs(backLon - lon)).toBeLessThan(1e-6);
        expect(Math.abs(backLat - lat)).toBeLessThan(1e-6);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/model/tests/projection.test.ts`
Expected: FAIL — cannot resolve `../src/projection`.

- [ ] **Step 3: Write the implementation**

`packages/model/src/projection.ts`:

```typescript
/**
 * Equal Earth (Savric, Patterson & Jenny, 2018). Equal-area, so territorial
 * extent reads honestly — decision 0002. Forward transform ported from the
 * Phase 0 spike; the inverse is new, because the round-trip acceptance
 * criterion needs it and Equal Earth has no closed form.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** y as a function of the parametric latitude theta. */
function yOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 * theta + A2 * theta * t2 + A3 * theta * t6 + A4 * theta * t6 * t2;
}

/** dy/dtheta. Strictly positive over the valid range, so Newton converges. */
function dyOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + 7 * A3 * t6 + 9 * A4 * t6 * t2;
}

export function equalEarth(lon: number, lat: number): [number, number] {
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const theta = Math.asin(M * Math.sin(phi));
  return [(lambda * Math.cos(theta)) / (M * dyOf(theta)), yOf(theta)];
}

/**
 * Newton iteration on y to recover theta, then closed form for lon and lat.
 * Converges in fewer than ten iterations everywhere; the cap is a guard, not a
 * budget. Longitude is not recoverable exactly at the poles, where every
 * meridian collapses to x = 0.
 */
export function equalEarthInverse(x: number, y: number): [number, number] {
  let theta = y;
  for (let i = 0; i < 20; i++) {
    const step = (yOf(theta) - y) / dyOf(theta);
    theta -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  const lambda = (x * M * dyOf(theta)) / Math.cos(theta);
  const phi = Math.asin(Math.sin(theta) / M);
  return [lambda * DEG, phi * DEG];
}
```

- [ ] **Step 4: Re-export and run the test**

Add `export * from "./projection";` to `packages/model/src/index.ts`.

Run: `pnpm vitest run packages/model/tests/projection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/model
git commit -m "feat(model): Equal Earth projection with iterative inverse"
```

---

### Task 5: The deterministic artifact contract

Byte-identical output is an acceptance criterion, and `JSON.stringify` does not guarantee key order across construction paths. This task provides the one writer every artifact goes through, and records why determinism is scoped to a pinned toolchain rather than absolute.

**Files:**
- Create: `packages/model/src/artifact.ts`, `docs/decisions/0010-determinism-scoped-to-toolchain.md`
- Modify: `packages/model/src/index.ts`
- Test: `packages/model/tests/artifact.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `stableStringify(value: unknown): string`, `writeArtifact(path: string, value: unknown): void`, `readArtifact<T>(path: string): T`.

- [ ] **Step 1: Write the failing test**

`packages/model/tests/artifact.test.ts`:

```typescript
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArtifact, stableStringify, writeArtifact } from "../src/artifact";

describe("stableStringify", () => {
  it("orders object keys identically regardless of insertion order", () => {
    const a = { beta: 1, alpha: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 2, beta: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"alpha":2,"beta":1,"gamma":3}');
  });

  it("orders keys by code point, not by locale", () => {
    expect(stableStringify({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
  });

  it("preserves array order, which carries meaning in geometry", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts nested objects too", () => {
    expect(stableStringify({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });

  it("drops undefined properties rather than emitting invalid JSON", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("throws on non-finite numbers instead of silently writing null", () => {
    expect(() => stableStringify({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => stableStringify({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });
});

describe("writeArtifact", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artifact-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a trailing newline and no BOM", () => {
    const path = join(dir, "a.json");
    writeArtifact(path, { b: 1, a: 2 });
    const raw = readFileSync(path, "utf8");
    expect(raw).toBe('{"a":2,"b":1}\n');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("produces byte-identical files for equivalent values", () => {
    const one = join(dir, "one.json");
    const two = join(dir, "two.json");
    writeArtifact(one, { z: [1, 2], a: { n: 3 } });
    writeArtifact(two, { a: { n: 3 }, z: [1, 2] });
    expect(readFileSync(one)).toEqual(readFileSync(two));
  });

  it("round-trips through readArtifact", () => {
    const path = join(dir, "r.json");
    const value = { rows: [{ id: "x", n: 1 }], schemaVersion: 1 };
    writeArtifact(path, value);
    expect(readArtifact<typeof value>(path)).toEqual(value);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/model/tests/artifact.test.ts`
Expected: FAIL — cannot resolve `../src/artifact`.

- [ ] **Step 3: Write the implementation**

`packages/model/src/artifact.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";

/**
 * JSON with deterministic key ordering. Byte-identical output is an acceptance
 * criterion, and JSON.stringify preserves insertion order, which differs
 * between construction paths that produce equivalent values.
 *
 * Keys sort by code point via plain comparison, never localeCompare, which is
 * locale-dependent and would make output vary by machine.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite number in artifact: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",");
  return `{${body}}`;
}

/** The only way artifacts are written. LF endings, trailing newline, no BOM. */
export function writeArtifact(path: string, value: unknown): void {
  writeFileSync(path, `${stableStringify(value)}\n`, "utf8");
}

export function readArtifact<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/model/tests/artifact.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the decision record**

`docs/decisions/0010-determinism-scoped-to-toolchain.md`:

```markdown
# 0010 — Determinism is scoped to the pinned toolchain

**Status:** accepted

## Context

"Identical inputs produce byte-identical outputs" is an acceptance criterion.
Taken absolutely it is not achievable: the projection maths calls `Math.sin` and
`Math.asin`, whose results are engine-dependent, and later phases add mapshaper,
whose floating-point output depends on its own version.

## Decision

Determinism holds **for a pinned toolchain**: the Node version in `.nvmrc` and
the exact dependency versions in the lockfile. Bumping either is a deliberate
act that ends with re-blessing the golden fixture artifacts and reviewing the
diff.

Three things make this real rather than aspirational:

- Inputs are checksum-pinned, so "identical inputs" is verified, not assumed.
- Every artifact goes through one writer with sorted keys, LF endings and a
  trailing newline.
- Coordinates are stored as scaled integers, so no float formatting decision
  reaches the output.

## Consequences

- No wall-clock timestamps anywhere in `dist/`. Provenance is upstream versions
  and checksums, which are properties of the inputs rather than of the run.
- A toolchain bump shows up as a fixture diff. That is the intended signal, not
  a nuisance.
- CI runs on the same Node major version as `.nvmrc`, or the determinism test is
  meaningless.
```

- [ ] **Step 6: Re-export, verify and commit**

Add `export * from "./artifact";` to `packages/model/src/index.ts`.

```bash
pnpm test && pnpm lint && pnpm typecheck
git add packages/model docs/decisions/0010-determinism-scoped-to-toolchain.md
git commit -m "feat(model): deterministic artifact writer, and ADR 0010"
```

---

### Task 6: Pinned sources and the checksum-verifying downloader

Stage 1 of the pipeline. Inputs are pinned by checksum so that "identical inputs" in the determinism criterion is verified rather than assumed. The downloader never proceeds with unverified bytes.

**Files:**
- Create: `packages/pipeline/src/sources.ts`, `packages/pipeline/src/fetch/download.ts`
- Modify: `packages/pipeline/package.json`
- Test: `packages/pipeline/tests/fetch.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SourceSpec`, `SOURCES` (a `Record<string, SourceSpec>`), `sourcePath(spec, dir): string`, `sha256Of(buf: Buffer): string`, `type Fetcher = (url: string) => Promise<Buffer>`, `httpFetcher: Fetcher`, and `fetchSource(spec, outDir, opts): Promise<FetchResult>` where `FetchResult` is `{ dataset: string; path: string; sha256: string; bytes: number; cached: boolean }`.

- [ ] **Step 1: Add the zip dependency**

`adm-zip` reads the Cliopatria zip. It is MIT with zero transitive dependencies, which is why it is preferred over shelling out to `unzip` — the latter is an undeclared system dependency that would break on machines without it.

```bash
pnpm --filter @history/pipeline add adm-zip
pnpm --filter @history/pipeline add -D @types/adm-zip
```

- [ ] **Step 2: Write the failing test**

`packages/pipeline/tests/fetch.test.ts`:

```typescript
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fetcher, fetchSource, sha256Of } from "../src/fetch/download";
import type { SourceSpec } from "../src/sources";

const BODY = Buffer.from('{"type":"FeatureCollection","features":[]}');
const BODY_SHA = sha256Of(BODY);

function specOf(overrides: Partial<SourceSpec> = {}): SourceSpec {
  return {
    dataset: "test",
    name: "Test source",
    license: "CC-BY-4.0",
    upstreamVersion: "1.0.0",
    url: "https://example.invalid/test.geojson",
    file: "test.geojson",
    sha256: BODY_SHA,
    ...overrides,
  };
}

describe("fetchSource", () => {
  let dir: string;
  let calls: string[];
  let fetcher: Fetcher;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fetch-"));
    calls = [];
    fetcher = async (url) => {
      calls.push(url);
      return BODY;
    };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("downloads, verifies and writes the raw file", async () => {
    const result = await fetchSource(specOf(), dir, { writePins: false, refresh: false, fetcher });
    expect(result.sha256).toBe(BODY_SHA);
    expect(result.cached).toBe(false);
    expect(readFileSync(join(dir, "test.geojson"))).toEqual(BODY);
  });

  it("fails hard when the checksum does not match, and writes nothing", async () => {
    const spec = specOf({ sha256: "0".repeat(64) });
    await expect(
      fetchSource(spec, dir, { writePins: false, refresh: false, fetcher }),
    ).rejects.toThrow(/checksum mismatch/i);
    expect(() => readFileSync(join(dir, "test.geojson"))).toThrow();
  });

  it("refuses to run against an unpinned source", async () => {
    const spec = specOf({ sha256: null });
    await expect(
      fetchSource(spec, dir, { writePins: false, refresh: false, fetcher }),
    ).rejects.toThrow(/unpinned/i);
  });

  it("allows an unpinned source only when writing pins", async () => {
    const spec = specOf({ sha256: null });
    const result = await fetchSource(spec, dir, { writePins: true, refresh: false, fetcher });
    expect(result.sha256).toBe(BODY_SHA);
  });

  it("skips the download when a verified copy is already present", async () => {
    writeFileSync(join(dir, "test.geojson"), BODY);
    const result = await fetchSource(specOf(), dir, { writePins: false, refresh: false, fetcher });
    expect(result.cached).toBe(true);
    expect(calls).toEqual([]);
  });

  it("re-downloads when refresh is set", async () => {
    writeFileSync(join(dir, "test.geojson"), BODY);
    await fetchSource(specOf(), dir, { writePins: false, refresh: true, fetcher });
    expect(calls).toHaveLength(1);
  });

  it("extracts the named entry from a zip and pins the zip itself", async () => {
    const zip = new AdmZip();
    zip.addFile("cliopatria.geojson", BODY);
    const zipped = zip.toBuffer();
    const spec = specOf({
      file: "cliopatria.geojson.zip",
      unpack: "cliopatria.geojson",
      sha256: sha256Of(zipped),
    });
    const zipFetcher: Fetcher = async () => zipped;
    const result = await fetchSource(spec, dir, {
      writePins: false,
      refresh: false,
      fetcher: zipFetcher,
    });
    expect(result.sha256).toBe(sha256Of(zipped));
    expect(readFileSync(join(dir, "cliopatria.geojson"))).toEqual(BODY);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/fetch.test.ts`
Expected: FAIL — cannot resolve `../src/fetch/download`.

- [ ] **Step 4: Write `packages/pipeline/src/sources.ts`**

The URLs below are the best-known locations. Task 7 verifies them against the live services and fills in `sha256` and `upstreamVersion`. Do not invent checksums.

```typescript
export interface SourceSpec {
  dataset: string;
  /** Human-readable name, copied into the manifest. */
  name: string;
  /** SPDX-style identifier, copied into the manifest. */
  license: string;
  upstreamVersion: string;
  url: string;
  /** Filename for the raw download. `sha256` pins exactly this file. */
  file: string;
  /** null means unpinned: fetch refuses to run without --write-pins. */
  sha256: string | null;
  /** Zip entry to extract. Also the filename the pipeline reads. */
  unpack?: string;
}

/**
 * The pinned inputs. Bumping any of these is a deliberate act: edit the pin,
 * re-fetch, re-run the build, re-run the acceptance checks and re-bless the
 * fixtures. See docs/data-sources.md.
 */
export const SOURCES: Record<string, SourceSpec> = {
  cliopatria: {
    dataset: "cliopatria",
    name: "Cliopatria (Seshat Global History Databank)",
    license: "CC-BY-4.0",
    upstreamVersion: "UNPINNED",
    url: "UNPINNED",
    file: "cliopatria.geojson.zip",
    unpack: "cliopatria.geojson",
    sha256: null,
  },
  naturalEarth110mLand: {
    dataset: "naturalEarth110mLand",
    name: "Natural Earth — land (110m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_110m_land.geojson",
    file: "ne_110m_land.geojson",
    sha256: null,
  },
  naturalEarth50mLand: {
    dataset: "naturalEarth50mLand",
    name: "Natural Earth — land (50m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_50m_land.geojson",
    file: "ne_50m_land.geojson",
    sha256: null,
  },
};

/** The file the pipeline actually reads: the unpacked entry when there is one. */
export function sourcePath(spec: SourceSpec, dir: string): string {
  return `${dir}/${spec.unpack ?? spec.file}`;
}
```

- [ ] **Step 5: Write `packages/pipeline/src/fetch/download.ts`**

```typescript
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { SourceSpec } from "../sources";

export function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type Fetcher = (url: string) => Promise<Buffer>;

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
};

export interface FetchResult {
  dataset: string;
  path: string;
  sha256: string;
  bytes: number;
  cached: boolean;
}

export interface FetchOptions {
  /** Permit an unpinned source, so its checksum can be recorded. */
  writePins: boolean;
  refresh: boolean;
  fetcher?: Fetcher;
}

/**
 * Download one source, verify it, and unpack it if it is a zip.
 *
 * Nothing is written before the checksum matches. A pipeline that proceeds on
 * unverified input cannot make the determinism guarantee, so a mismatch is an
 * error and never a warning.
 */
export async function fetchSource(
  spec: SourceSpec,
  outDir: string,
  opts: FetchOptions,
): Promise<FetchResult> {
  mkdirSync(outDir, { recursive: true });
  const rawPath = join(outDir, spec.file);

  if (spec.sha256 === null && !opts.writePins) {
    throw new Error(
      `Source "${spec.dataset}" is unpinned. Run with --write-pins to record its checksum, ` +
        "then commit the values into packages/pipeline/src/sources.ts.",
    );
  }

  if (!opts.refresh && existsSync(rawPath)) {
    const existing = readFileSync(rawPath);
    const digest = sha256Of(existing);
    if (spec.sha256 === null || digest === spec.sha256) {
      unpackIfNeeded(spec, existing, outDir);
      return {
        dataset: spec.dataset,
        path: rawPath,
        sha256: digest,
        bytes: existing.length,
        cached: true,
      };
    }
    throw new Error(
      `Cached ${spec.dataset} checksum mismatch: expected ${spec.sha256}, found ${digest}. ` +
        "Delete the file and re-fetch, or correct the pin.",
    );
  }

  const fetcher = opts.fetcher ?? httpFetcher;
  const body = await fetcher(spec.url);
  const digest = sha256Of(body);
  if (spec.sha256 !== null && digest !== spec.sha256) {
    throw new Error(
      `Downloaded ${spec.dataset} checksum mismatch: expected ${spec.sha256}, got ${digest}. ` +
        "Upstream changed under a pinned version, which is a provenance failure. Nothing written.",
    );
  }

  writeFileSync(rawPath, body);
  unpackIfNeeded(spec, body, outDir);
  return { dataset: spec.dataset, path: rawPath, sha256: digest, bytes: body.length, cached: false };
}

function unpackIfNeeded(spec: SourceSpec, raw: Buffer, outDir: string): void {
  if (!spec.unpack) return;
  const target = join(outDir, spec.unpack);
  if (existsSync(target)) return;
  const entry = new AdmZip(raw).getEntry(spec.unpack);
  if (!entry) throw new Error(`Zip for ${spec.dataset} has no entry "${spec.unpack}"`);
  writeFileSync(target, entry.getData());
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/fetch.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/pipeline package.json pnpm-lock.yaml
git commit -m "feat(pipeline): pinned source manifest and checksum-verifying fetch"
```

---

### Task 7: Pin the real upstream sources

The only task in this plan that touches the network as its deliverable. It replaces the `UNPINNED` placeholders and the three `null` checksums with real values, which is what makes every later task reproducible.

**Files:**
- Modify: `packages/pipeline/src/sources.ts`
- Create: `packages/pipeline/src/cli.ts` (the `fetch` subcommand only; `build` is added in Task 14)

**Interfaces:**
- Consumes: `SOURCES`, `fetchSource` from Task 6.
- Produces: a working `pnpm fetch` command, and a fully pinned `SOURCES`.

- [ ] **Step 1: Write a minimal CLI with the fetch subcommand**

`packages/pipeline/src/cli.ts`:

```typescript
import { fetchSource } from "./fetch/download";
import { SOURCES } from "./sources";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function runFetch(): Promise<void> {
  const outDir = option("sources", "data/sources");
  const writePins = flag("write-pins");
  const refresh = flag("refresh");
  const pins: string[] = [];

  for (const spec of Object.values(SOURCES)) {
    const result = await fetchSource(spec, outDir, { writePins, refresh });
    const state = result.cached ? "cached" : "downloaded";
    console.log(`  ${spec.dataset}: ${state}, ${result.bytes} bytes, sha256 ${result.sha256}`);
    pins.push(`    sha256: "${result.sha256}",   // ${spec.dataset}`);
  }

  if (writePins) {
    console.log("\n  Paste these into packages/pipeline/src/sources.ts:\n");
    console.log(pins.join("\n"));
  }
}

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else {
  console.error(`Unknown command "${command ?? ""}". Known: fetch`);
  process.exit(1);
}
```

- [ ] **Step 2: Resolve the real Cliopatria download URL and version**

`docs/data-sources.md` pins Cliopatria to Zenodo DOI `10.5281/zenodo.13363121`. Ask Zenodo what that record actually contains:

```bash
curl -sL https://zenodo.org/api/records/13363121 | python3 -c "
import json, sys
r = json.load(sys.stdin)
print('version:', r['metadata'].get('version', '(none declared)'))
for f in r['files']:
    print(f['key'], f['size'], f['links']['self'])
"
```

Copy the `links.self` URL of the `.zip` whose name matches the GeoJSON release into `SOURCES.cliopatria.url`, set `file` to that entry's filename, and set `upstreamVersion` to the printed version. If the archive's internal entry is not named `cliopatria.geojson`, correct `unpack` to the real entry name — list it with `unzip -l` after the first download.

- [ ] **Step 3: Fetch with pin-writing enabled**

```bash
pnpm fetch --write-pins
```

Expected: three downloads, then a printed block of `sha256` values. If a Natural Earth URL 404s, the `v5.1.1` tag or the `geojson/` path has moved — browse https://github.com/nvkelso/natural-earth-vector/tags, pick a real tag, update both Natural Earth URLs and `upstreamVersion` to match, and re-run.

- [ ] **Step 4: Paste the pins and verify they hold**

Replace each `sha256: null` in `sources.ts` with the printed value, then run the fetch again *without* `--write-pins`:

```bash
pnpm fetch
```

Expected: all three report `cached`, and no error. This proves the pins match the bytes on disk. Now delete one file and re-fetch to prove the download path verifies too:

```bash
rm data/sources/ne_110m_land.geojson && pnpm fetch
```

Expected: `naturalEarth110mLand: downloaded`, no checksum error.

- [ ] **Step 5: Confirm the pinned data looks like what the docs describe**

```bash
python3 -c "
import json
d = json.load(open('data/sources/cliopatria.geojson'))
feats = d['features']
print('features:', len(feats))
types = {}
for f in feats:
    t = (f.get('properties') or {}).get('Type')
    types[t] = types.get(t, 0) + 1
print('Type counts:', types)
print('property keys:', sorted((feats[0].get('properties') or {}).keys()))
print('sample:', json.dumps({k: v for k, v in (feats[0].get('properties') or {}).items()}, default=str)[:400])
"
```

Expected, per `docs/data-sources.md`: roughly 14,000 features, a `POLITY` / `RELATION` split, and properties including `Name`, `Type`, `FromYear`, `ToYear`, `Area`, `Wikipedia`, `Wikidata`, `SeshatID`. **If the property names differ, note the real ones — Task 8 codes against them and must be adjusted.**

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/sources.ts packages/pipeline/src/cli.ts
git commit -m "feat(pipeline): pin Cliopatria and Natural Earth upstream versions and checksums"
```

---

### Task 8: Normalise raw GeoJSON into canonical rows

Stage 2. Cliopatria's per-feature properties become typed rows, with every dropped feature counted rather than silently discarded. Decision 0008 requires `RELATION` rows to be filtered out; `docs/standards.md` requires the counts to be visible.

**Files:**
- Create: `packages/pipeline/src/stages/normalise.ts`
- Test: `packages/pipeline/tests/normalise.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LonLat`, `LonLatRing`, `LonLatPolygon`, `NormalisedRow`, `NormaliseReport`, `toYear(value: unknown): number | null`, `toWikidata(value: unknown): string | null`, `toWikipedia(value: unknown): string | null`, `normaliseCliopatria(features: unknown[]): { rows: NormalisedRow[]; report: NormaliseReport }`, `normaliseLand(features: unknown[]): { polygons: LonLatPolygon[]; report: NormaliseReport }`.

> **Before starting:** Task 7 Step 5 printed the real Cliopatria property keys. If they differ from `Name` / `Type` / `FromYear` / `ToYear` / `Area` / `Wikipedia` / `Wikidata` / `SeshatID`, use the real ones throughout this task.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/normalise.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  normaliseCliopatria,
  normaliseLand,
  toWikidata,
  toWikipedia,
  toYear,
} from "../src/stages/normalise";

const square = (cx: number, cy: number) => [
  [cx, cy],
  [cx + 1, cy],
  [cx + 1, cy + 1],
  [cx, cy + 1],
  [cx, cy],
];

function polity(props: Record<string, unknown>, coordinates: unknown = [square(0, 0)]) {
  return {
    type: "Feature",
    properties: { Type: "POLITY", Name: "Test", FromYear: 0, ToYear: 100, Area: 1, ...props },
    geometry: { type: "Polygon", coordinates },
  };
}

describe("toYear", () => {
  it("accepts integers, including negative ones for BCE", () => {
    expect(toYear(-200)).toBe(-200);
  });
  it("coerces the string years some rows arrive with", () => {
    expect(toYear(" -200 ")).toBe(-200);
    expect(toYear("1492")).toBe(1492);
  });
  it("rejects unusable values", () => {
    expect(toYear(null)).toBeNull();
    expect(toYear("")).toBeNull();
    expect(toYear("oops")).toBeNull();
  });
});

describe("toWikidata", () => {
  it("accepts a bare Q-id and a full URL", () => {
    expect(toWikidata("Q1747689")).toBe("Q1747689");
    expect(toWikidata("https://www.wikidata.org/wiki/Q1747689")).toBe("Q1747689");
  });
  it("returns null for anything that is not a Q-id", () => {
    expect(toWikidata("")).toBeNull();
    expect(toWikidata("n/a")).toBeNull();
    expect(toWikidata(null)).toBeNull();
  });
});

describe("toWikipedia", () => {
  it("normalises titles, slugs and URLs to one underscore form", () => {
    expect(toWikipedia("Roman Empire")).toBe("Roman_Empire");
    expect(toWikipedia("Roman_Empire")).toBe("Roman_Empire");
    expect(toWikipedia("https://en.wikipedia.org/wiki/Roman_Empire")).toBe("Roman_Empire");
    expect(toWikipedia("https://en.wikipedia.org/wiki/C%C3%B4te_d%27Ivoire")).toBe(
      "Côte_d'Ivoire",
    );
  });
  it("returns null when empty", () => {
    expect(toWikipedia("  ")).toBeNull();
  });
});

describe("normaliseCliopatria", () => {
  it("drops non-POLITY rows and counts them (decision 0008)", () => {
    const { rows, report } = normaliseCliopatria([
      polity({}),
      { ...polity({}), properties: { Type: "RELATION", Name: "R", FromYear: 0, ToYear: 1 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedNonPolity).toBe(1);
  });

  it("drops rows with unusable or inverted years and counts them", () => {
    const { rows, report } = normaliseCliopatria([
      polity({ FromYear: null }),
      polity({ ToYear: "oops" }),
      polity({ FromYear: 500, ToYear: 100 }),
      polity({}),
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedYears).toBe(3);
  });

  it("drops rows whose geometry yields no usable ring and counts them", () => {
    const { rows, report } = normaliseCliopatria([
      polity({}, [[[0, 0], [1, 1]]]),
      polity({}, [[[0, 0], [1, 0], [Number.NaN, 1], [0, 0]]]),
      polity({}),
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedGeometry).toBe(2);
  });

  it("closes an unclosed ring and counts it, rather than emitting an open ring", () => {
    const open = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const { rows, report } = normaliseCliopatria([polity({}, [open])]);
    const ring = rows[0]?.polygons[0]?.[0];
    expect(ring).toHaveLength(5);
    expect(ring?.[4]).toEqual([0, 0]);
    expect(report.closedRings).toBe(1);
  });

  it("keeps every ring of a MultiPolygon, holes included", () => {
    const feature = {
      type: "Feature",
      properties: { Type: "POLITY", Name: "M", FromYear: 0, ToYear: 1, Area: 2 },
      geometry: {
        type: "MultiPolygon",
        coordinates: [[square(0, 0), square(0, 0)], [square(10, 10)]],
      },
    };
    const { rows } = normaliseCliopatria([feature]);
    expect(rows[0]?.polygons).toHaveLength(2);
    expect(rows[0]?.polygons[0]).toHaveLength(2);
  });

  it("carries the reference identifiers through", () => {
    const { rows } = normaliseCliopatria([
      polity({ Name: "Roman Empire", Wikidata: "Q1747689", Wikipedia: "Roman Empire", SeshatID: 12 }),
    ]);
    expect(rows[0]).toMatchObject({
      name: "Roman Empire",
      wikidata: "Q1747689",
      wikipedia: "Roman_Empire",
      seshat: "12",
    });
  });
});

describe("normaliseLand", () => {
  it("flattens Natural Earth features into a flat polygon list", () => {
    const { polygons } = normaliseLand([
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [square(0, 0)] } },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[square(5, 5)], [square(9, 9)]] },
      },
    ]);
    expect(polygons).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/normalise.test.ts`
Expected: FAIL — cannot resolve `../src/stages/normalise`.

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/normalise.ts`:

```typescript
export type LonLat = [number, number];
export type LonLatRing = LonLat[];
/** Outer ring first, holes after. */
export type LonLatPolygon = LonLatRing[];

export interface NormalisedRow {
  name: string;
  wikidata: string | null;
  wikipedia: string | null;
  seshat: string | null;
  fromYear: number;
  toYear: number;
  area: number;
  polygons: LonLatPolygon[];
}

export interface NormaliseReport {
  kept: number;
  /** Almost entirely RELATION rows. Dropped per decision 0008. */
  droppedNonPolity: number;
  droppedYears: number;
  droppedGeometry: number;
  closedRings: number;
}

function emptyReport(): NormaliseReport {
  return { kept: 0, droppedNonPolity: 0, droppedYears: 0, droppedGeometry: 0, closedRings: 0 };
}

function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}

/** Cliopatria years are integers, negative for BCE. Some rows carry them as strings. */
export function toYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toWikidata(value: unknown): string | null {
  const s = toText(value);
  if (s === null) return null;
  const match = /(Q\d+)\s*$/.exec(s);
  return match ? (match[1] as string) : null;
}

/**
 * One canonical form for the article title, whatever shape the source uses.
 * This is a reference identifier for future enrichment joins, not an outbound
 * link — see docs/phase-1-design.md D13.
 */
export function toWikipedia(value: unknown): string | null {
  const s = toText(value);
  if (s === null) return null;
  const last = s.includes("/") ? (s.split("/").pop() as string) : s;
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    // Malformed percent-encoding: keep the raw segment rather than dropping the row.
  }
  const title = decoded.trim().replace(/\s+/g, "_");
  return title === "" ? null : title;
}

function ringOf(raw: unknown, report: NormaliseReport): LonLatRing | null {
  if (!Array.isArray(raw)) return null;
  const ring: LonLatRing = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push([lon, lat]);
  }
  if (ring.length < 4) return null;
  const first = ring[0] as LonLat;
  const last = ring[ring.length - 1] as LonLat;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    // GeoJSON rings are closed by definition. Completing an unclosed one is
    // reading the format, not inventing a border.
    ring.push([first[0], first[1]]);
    report.closedRings++;
  }
  return ring;
}

function polygonsOf(geometry: unknown, report: NormaliseReport): LonLatPolygon[] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return [];
  const groups =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? (g.coordinates as unknown[])
        : [];
  const out: LonLatPolygon[] = [];
  for (const group of groups) {
    if (!Array.isArray(group) || group.length === 0) continue;
    // An invalid outer ring discards the polygon; a hole is skipped on its own,
    // because promoting a hole to an outer ring would invent territory.
    const outer = ringOf(group[0], report);
    if (!outer) continue;
    const polygon: LonLatPolygon = [outer];
    for (let i = 1; i < group.length; i++) {
      const hole = ringOf(group[i], report);
      if (hole) polygon.push(hole);
    }
    out.push(polygon);
  }
  return out;
}

export function normaliseCliopatria(features: unknown[]): {
  rows: NormalisedRow[];
  report: NormaliseReport;
} {
  const report = emptyReport();
  const rows: NormalisedRow[] = [];

  for (const feature of features) {
    const f = feature as { properties?: Record<string, unknown> | null; geometry?: unknown };
    const props = f.properties ?? {};

    if (String(props.Type ?? "").toUpperCase() !== "POLITY") {
      report.droppedNonPolity++;
      continue;
    }

    const fromYear = toYear(props.FromYear);
    const toYearValue = toYear(props.ToYear);
    if (fromYear === null || toYearValue === null || fromYear > toYearValue) {
      report.droppedYears++;
      continue;
    }

    const polygons = polygonsOf(f.geometry, report);
    if (polygons.length === 0) {
      report.droppedGeometry++;
      continue;
    }

    rows.push({
      name: toText(props.Name) ?? "unnamed",
      wikidata: toWikidata(props.Wikidata),
      wikipedia: toWikipedia(props.Wikipedia),
      seshat: toText(props.SeshatID),
      fromYear,
      toYear: toYearValue,
      area: Number.isFinite(Number(props.Area)) ? Number(props.Area) : 0,
      polygons,
    });
    report.kept++;
  }

  return { rows, report };
}

/** Natural Earth carries no properties worth keeping — decision 0003. */
export function normaliseLand(features: unknown[]): {
  polygons: LonLatPolygon[];
  report: NormaliseReport;
} {
  const report = emptyReport();
  const polygons: LonLatPolygon[] = [];
  for (const feature of features) {
    const f = feature as { geometry?: unknown };
    const found = polygonsOf(f.geometry, report);
    if (found.length === 0) report.droppedGeometry++;
    polygons.push(...found);
  }
  report.kept = polygons.length;
  return { polygons, report };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/normalise.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): normalise raw GeoJSON into canonical rows"
```

---

### Task 9: Polity identity resolution

Stage 3. Decision 0007 keys polities on the Wikidata id where present, falling back to a normalised name, with hand-fixes in a committed alias file. Lineage depends entirely on this: get identity wrong and every polity's chain resets, which breaks the expansion flash (decision 0004).

**Files:**
- Create: `packages/model/src/ids.ts`, `packages/pipeline/src/stages/identity.ts`, `packages/pipeline/aliases.json`
- Modify: `packages/model/src/index.ts`
- Test: `packages/pipeline/tests/identity.test.ts`

**Interfaces:**
- Consumes: `normalizeName` (Task 3), `Polity` (Task 2), `NormalisedRow` (Task 8).
- Produces, from `@history/model`: `polityIdFromWikidata(wikidata: string): string`, `polityIdFromName(normalizedName: string): string`, `versionIdFor(polityId: string, fromYear: number): string`. From the pipeline: `AliasEntry`, `resolvePolityId(row, aliases): string`, `assignIdentity(rows, aliases): { polities: Polity[]; rowPolityIds: string[] }` where `rowPolityIds` is positionally aligned with `rows`.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/identity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { type AliasEntry, assignIdentity, resolvePolityId } from "../src/stages/identity";
import type { NormalisedRow } from "../src/stages/normalise";

function row(overrides: Partial<NormalisedRow> = {}): NormalisedRow {
  return {
    name: "Roman Empire",
    wikidata: null,
    wikipedia: null,
    seshat: null,
    fromYear: 0,
    toYear: 100,
    area: 1,
    polygons: [],
    ...overrides,
  };
}

describe("resolvePolityId", () => {
  it("keys on the Wikidata id when the row has one", () => {
    expect(resolvePolityId(row({ wikidata: "Q1747689" }), [])).toBe("wd:Q1747689");
  });

  it("falls back to the normalised name when it does not", () => {
    expect(resolvePolityId(row({ name: "Kingdom of Numidia" }), [])).toBe(
      "name:kingdom-of-numidia",
    );
  });

  it("lets an alias on name override the fallback", () => {
    const aliases: AliasEntry[] = [
      { match: { name: "Roman Empire (Western)" }, canonical: "wd:Q1747689", reason: "split label" },
    ];
    expect(resolvePolityId(row({ name: "Roman Empire (Western)" }), aliases)).toBe("wd:Q1747689");
  });

  it("lets an alias on wikidata override a merged or redirected item", () => {
    const aliases: AliasEntry[] = [
      { match: { wikidata: "Q999" }, canonical: "wd:Q1747689", reason: "merged upstream" },
    ];
    expect(resolvePolityId(row({ wikidata: "Q999" }), aliases)).toBe("wd:Q1747689");
  });
});

describe("assignIdentity", () => {
  it("collapses many rows of one polity into a single Polity", () => {
    const rows = [
      row({ wikidata: "Q1747689", fromYear: -27 }),
      row({ wikidata: "Q1747689", fromYear: 117 }),
    ];
    const { polities, rowPolityIds } = assignIdentity(rows, []);
    expect(polities).toHaveLength(1);
    expect(rowPolityIds).toEqual(["wd:Q1747689", "wd:Q1747689"]);
  });

  it("takes the first non-null reference identifier across a polity's rows", () => {
    const rows = [
      row({ wikidata: "Q1", wikipedia: null, seshat: null }),
      row({ wikidata: "Q1", wikipedia: "Roman_Empire", seshat: "12" }),
    ];
    const { polities } = assignIdentity(rows, []);
    expect(polities[0]).toMatchObject({
      id: "wd:Q1",
      wikidata: "Q1",
      wikipedia: "Roman_Empire",
      seshat: "12",
    });
  });

  it("stores the normalised name so the deferred drift report has data to diff", () => {
    const { polities } = assignIdentity([row({ name: "Côte d'Ivoire" })], []);
    expect(polities[0]?.normalizedName).toBe("cote-d-ivoire");
  });

  it("returns polities sorted by id, so output ordering is deterministic", () => {
    const rows = [row({ name: "Zeta" }), row({ name: "Alpha" }), row({ wikidata: "Q5" })];
    const { polities } = assignIdentity(rows, []);
    expect(polities.map((p) => p.id)).toEqual(["name:alpha", "name:zeta", "wd:Q5"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/identity.test.ts`
Expected: FAIL — cannot resolve `../src/stages/identity`.

- [ ] **Step 3: Write `packages/model/src/ids.ts`**

```typescript
/**
 * Artifact-contract id construction. Lives in the model because the viewer
 * reads these ids out of artifacts and must not reach into the pipeline.
 */

export function polityIdFromWikidata(wikidata: string): string {
  return `wd:${wikidata}`;
}

export function polityIdFromName(normalizedName: string): string {
  return `name:${normalizedName}`;
}

/**
 * Unique because "no polity has two versions with the same from_year" is an
 * acceptance criterion, enforced in the lineage stage.
 */
export function versionIdFor(polityId: string, fromYear: number): string {
  return `${polityId}@${fromYear}`;
}
```

Add `export * from "./ids";` to `packages/model/src/index.ts`.

- [ ] **Step 4: Write `packages/pipeline/src/stages/identity.ts`**

```typescript
import { normalizeName, polityIdFromName, polityIdFromWikidata } from "@history/model";
import type { Polity } from "@history/model";
import type { NormalisedRow } from "./normalise";

/** A hand-maintained fix in packages/pipeline/aliases.json. Decision 0007. */
export interface AliasEntry {
  match: { name?: string; wikidata?: string };
  canonical: string;
  reason: string;
}

export function resolvePolityId(
  row: Pick<NormalisedRow, "name" | "wikidata">,
  aliases: AliasEntry[],
): string {
  for (const alias of aliases) {
    if (alias.match.wikidata !== undefined && alias.match.wikidata === row.wikidata) {
      return alias.canonical;
    }
    if (alias.match.name !== undefined && alias.match.name === row.name) {
      return alias.canonical;
    }
  }
  // Wikidata Q-ids are permanent and survive relabelling, so they are the
  // primary key. The normalised name is the fallback, not the preference.
  if (row.wikidata !== null) return polityIdFromWikidata(row.wikidata);
  return polityIdFromName(normalizeName(row.name));
}

export interface IdentityResult {
  polities: Polity[];
  /** Positionally aligned with the input rows. */
  rowPolityIds: string[];
}

export function assignIdentity(rows: NormalisedRow[], aliases: AliasEntry[]): IdentityResult {
  const byId = new Map<string, Polity>();
  const rowPolityIds: string[] = [];

  for (const row of rows) {
    const id = resolvePolityId(row, aliases);
    rowPolityIds.push(id);

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        name: row.name,
        normalizedName: normalizeName(row.name),
        wikidata: row.wikidata,
        wikipedia: row.wikipedia,
        seshat: row.seshat,
      });
      continue;
    }
    // First non-null wins, so a polity keeps every identifier any of its rows
    // carries without depending on which row happened to come first.
    if (existing.wikidata === null) existing.wikidata = row.wikidata;
    if (existing.wikipedia === null) existing.wikipedia = row.wikipedia;
    if (existing.seshat === null) existing.seshat = row.seshat;
  }

  const polities = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { polities, rowPolityIds };
}
```

- [ ] **Step 5: Create the empty alias file**

`packages/pipeline/aliases.json`:

```json
{
  "$comment": "Hand-maintained polity identity fixes. See docs/decisions/0007-polity-identity.md. Every entry needs a reason.",
  "aliases": []
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/identity.test.ts && pnpm typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/model packages/pipeline
git commit -m "feat(pipeline): polity identity resolution with alias overrides"
```

---

### Task 10: Derive lineage

Stage 4, and the reason this phase exists. Cliopatria stores versions independently with no link between them, so without this the renderer cannot tell growth from shrinkage and decision 0004 has nothing to work with. Two invariants fail the build here rather than reaching the output.

**Files:**
- Create: `packages/pipeline/src/stages/lineage.ts`, `packages/pipeline/overlaps.json`
- Test: `packages/pipeline/tests/lineage.test.ts`

**Interfaces:**
- Consumes: `versionIdFor` (Task 9), `Version` (Task 2), `NormalisedRow` (Task 8).
- Produces: `OverlapWhitelistEntry`, `LineageResult` (`{ versions: Version[]; overlaps: Array<{ earlier: string; later: string }>; rowIndexById: Record<string, number> }`), and `deriveLineage(rows, rowPolityIds, whitelist, sourceVersion): LineageResult`.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/lineage.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { deriveLineage } from "../src/stages/lineage";
import type { NormalisedRow } from "../src/stages/normalise";

function row(fromYear: number, toYear: number, area: number): NormalisedRow {
  return {
    name: "P",
    wikidata: null,
    wikipedia: null,
    seshat: null,
    fromYear,
    toYear,
    area,
    polygons: [],
  };
}

const P = "wd:Q1";
const Q = "wd:Q2";

describe("deriveLineage", () => {
  it("leaves prevId, delta and gap null on a first appearance", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "1.0.0");
    expect(versions[0]).toMatchObject({ prevId: null, delta: null, gap: null });
  });

  it("sets all three on every later version", () => {
    const rows = [row(0, 50, 10), row(80, 120, 25)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions[1]).toMatchObject({ prevId: "wd:Q1@0", delta: 15, gap: 30 });
  });

  it("computes delta as area minus prev.area, including for contraction", () => {
    const rows = [row(0, 50, 40), row(60, 90, 25)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions[1]?.delta).toBe(-15);
  });

  it("floors gap at zero for versions that abut exactly", () => {
    const rows = [row(0, 50, 10), row(50, 90, 10)];
    const { versions } = deriveLineage(rows, [P, P], [{ earlier: "wd:Q1@0", later: "wd:Q1@50", reason: "abuts" }], "1.0.0");
    expect(versions[1]?.gap).toBe(0);
  });

  it("orders by fromYear regardless of input order", () => {
    const rows = [row(80, 120, 25), row(0, 50, 10)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions.map((v) => v.fromYear)).toEqual([0, 80]);
    expect(versions[1]?.prevId).toBe("wd:Q1@0");
  });

  it("keeps lineage chains separate per polity", () => {
    const rows = [row(0, 50, 10), row(0, 50, 99)];
    const { versions } = deriveLineage(rows, [P, Q], [], "1.0.0");
    expect(versions.every((v) => v.prevId === null)).toBe(true);
  });

  it("fails the build when one polity has two versions with the same from_year", () => {
    const rows = [row(0, 50, 10), row(0, 90, 20)];
    expect(() => deriveLineage(rows, [P, P], [], "1.0.0")).toThrow(/same from_year/i);
  });

  it("fails the build on an overlap that is not whitelisted", () => {
    const rows = [row(0, 100, 10), row(50, 150, 20)];
    expect(() => deriveLineage(rows, [P, P], [], "1.0.0")).toThrow(/not whitelisted/i);
  });

  it("permits an overlap that is whitelisted with a reason, and still reports it", () => {
    const rows = [row(0, 100, 10), row(50, 150, 20)];
    const whitelist = [{ earlier: "wd:Q1@0", later: "wd:Q1@50", reason: "co-regency in source" }];
    const { versions, overlaps } = deriveLineage(rows, [P, P], whitelist, "1.0.0");
    expect(versions).toHaveLength(2);
    expect(overlaps).toEqual([{ earlier: "wd:Q1@0", later: "wd:Q1@50" }]);
  });

  it("leaves confidence unpopulated (decision 0005)", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "1.0.0");
    expect(versions[0]?.confidence).toBeNull();
  });

  it("records which upstream release each version came from", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "2.1.0");
    expect(versions[0]?.source).toEqual({ dataset: "cliopatria", version: "2.1.0" });
  });

  it("maps every version id back to its source row, so geometry can follow", () => {
    const rows = [row(80, 120, 25), row(0, 50, 10)];
    const { rowIndexById } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(rowIndexById["wd:Q1@80"]).toBe(0);
    expect(rowIndexById["wd:Q1@0"]).toBe(1);
  });

  it("sorts output by polity then year, so the artifact is deterministic", () => {
    const rows = [row(0, 10, 1), row(0, 10, 1), row(20, 30, 1)];
    const { versions } = deriveLineage(rows, [Q, P, P], [], "1.0.0");
    expect(versions.map((v) => v.id)).toEqual(["wd:Q1@0", "wd:Q1@20", "wd:Q2@0"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/lineage.test.ts`
Expected: FAIL — cannot resolve `../src/stages/lineage`.

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/lineage.ts`:

```typescript
import { versionIdFor } from "@history/model";
import type { Version } from "@history/model";
import type { NormalisedRow } from "./normalise";

/** An entry in packages/pipeline/overlaps.json. Every one needs a reason. */
export interface OverlapWhitelistEntry {
  earlier: string;
  later: string;
  reason: string;
}

export interface LineageResult {
  versions: Version[];
  overlaps: Array<{ earlier: string; later: string }>;
  /** version id -> index into the input rows, so geometry can follow the version. */
  rowIndexById: Record<string, number>;
}

/**
 * Group by polity, sort by year, link each version to its predecessor.
 *
 * `prevId`, `delta` and `gap` exist only here — Cliopatria stores versions
 * independently. Decision 0004's expansion flash reads all three, and `gap` is
 * what keeps it honest: a version arriving after a long hole represents
 * accumulated drift rather than a datable event.
 */
export function deriveLineage(
  rows: NormalisedRow[],
  rowPolityIds: string[],
  whitelist: OverlapWhitelistEntry[],
  sourceVersion: string,
): LineageResult {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const polityId = rowPolityIds[i] as string;
    const bucket = groups.get(polityId);
    if (bucket) bucket.push(i);
    else groups.set(polityId, [i]);
  }

  const duplicates: string[] = [];
  const overlaps: Array<{ earlier: string; later: string }> = [];
  const versions: Version[] = [];
  const rowIndexById: Record<string, number> = {};

  for (const [polityId, indices] of groups) {
    indices.sort((a, b) => {
      const ra = rows[a] as NormalisedRow;
      const rb = rows[b] as NormalisedRow;
      return ra.fromYear - rb.fromYear || ra.toYear - rb.toYear || a - b;
    });

    let prev: Version | null = null;
    for (const index of indices) {
      const source = rows[index] as NormalisedRow;

      if (prev !== null && prev.fromYear === source.fromYear) {
        duplicates.push(`${polityId} has two versions starting in ${source.fromYear}`);
        continue;
      }

      const id = versionIdFor(polityId, source.fromYear);
      const version: Version = {
        id,
        polityId,
        fromYear: source.fromYear,
        toYear: source.toYear,
        area: source.area,
        prevId: prev === null ? null : prev.id,
        delta: prev === null ? null : source.area - prev.area,
        gap: prev === null ? null : Math.max(0, source.fromYear - prev.toYear),
        confidence: null,
        source: { dataset: "cliopatria", version: sourceVersion },
      };

      if (prev !== null && source.fromYear <= prev.toYear) {
        overlaps.push({ earlier: prev.id, later: id });
      }

      versions.push(version);
      rowIndexById[id] = index;
      prev = version;
    }
  }

  // Fail the build, do not warn. A warning in a pipeline nobody watches is the
  // same as no check at all — docs/standards.md.
  if (duplicates.length > 0) {
    throw new Error(
      `${duplicates.length} polities have two versions with the same from_year, which breaks the ` +
        `version id. Fix the data or add an alias.\n  ${duplicates.slice(0, 20).join("\n  ")}`,
    );
  }

  const allowed = new Set(whitelist.map((w) => `${w.earlier}|${w.later}`));
  const unlisted = overlaps.filter((o) => !allowed.has(`${o.earlier}|${o.later}`));
  if (unlisted.length > 0) {
    const sample = unlisted
      .slice(0, 20)
      .map((o) => `${o.earlier} overlaps ${o.later}`)
      .join("\n  ");
    throw new Error(
      `${unlisted.length} of ${overlaps.length} version overlaps are not whitelisted. Add each to ` +
        `packages/pipeline/overlaps.json with a reason, or fix the data.\n  ${sample}`,
    );
  }

  versions.sort(
    (a, b) =>
      (a.polityId < b.polityId ? -1 : a.polityId > b.polityId ? 1 : 0) ||
      a.fromYear - b.fromYear ||
      a.toYear - b.toYear,
  );

  return { versions, overlaps, rowIndexById };
}
```

- [ ] **Step 4: Create the empty overlap whitelist**

`packages/pipeline/overlaps.json`:

```json
{
  "$comment": "Versions of one polity whose intervals overlap. The build fails on any overlap not listed here. Every entry needs a reason explaining why the overlap is real rather than a data error.",
  "overlaps": []
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/lineage.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): derive prevId, delta and gap, failing on duplicates and overlaps"
```

---

### Task 11: Antimeridian cutting

The one place in this pipeline where geometry is split. A ring that crosses ±180° projects into a stripe spanning the whole map, which is a worse falsehood than the cut. This task implements the cut in lon/lat space, before projection, and records the decision.

**Files:**
- Create: `packages/pipeline/src/stages/antimeridian.ts`, `docs/decisions/0011-antimeridian-cutting.md`
- Test: `packages/pipeline/tests/antimeridian.test.ts`

**Interfaces:**
- Consumes: `LonLat`, `LonLatRing`, `LonLatPolygon` (Task 8).
- Produces: `ringWraps(ring: LonLatRing): boolean`, `cutPolygonAtAntimeridian(polygon: LonLatPolygon): LonLatPolygon[]`, `cutPolygons(polygons: LonLatPolygon[]): { polygons: LonLatPolygon[]; cut: number }`.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/antimeridian.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { cutPolygonAtAntimeridian, cutPolygons, ringWraps } from "../src/stages/antimeridian";
import type { LonLatPolygon, LonLatRing } from "../src/stages/normalise";

/** A closed rectangle ring, counter-clockwise. */
function box(minLon: number, minLat: number, maxLon: number, maxLat: number): LonLatRing {
  return [
    [minLon, minLat],
    [maxLon, minLat],
    [maxLon, maxLat],
    [minLon, maxLat],
    [minLon, minLat],
  ];
}

/** A box written the way GeoJSON expresses one straddling the antimeridian. */
const straddling: LonLatRing = [
  [170, 0],
  [-170, 0],
  [-170, 10],
  [170, 10],
  [170, 0],
];

describe("ringWraps", () => {
  it("is false for an ordinary ring", () => {
    expect(ringWraps(box(0, 0, 10, 10))).toBe(false);
  });
  it("reads a 358-degree step as a crossing, which is the only reading available", () => {
    // A box written -179 -> 179 is indistinguishable from one crossing the
    // antimeridian: both are a step of more than 180 degrees. GeoJSON gives no
    // way to tell them apart, so the wrapping reading wins. Nothing in
    // Cliopatria spans the world the long way round, so this costs nothing.
    expect(ringWraps(box(-179, 0, 179, 10))).toBe(true);
  });
  it("is true when a segment jumps more than 180 degrees", () => {
    expect(ringWraps(straddling)).toBe(true);
  });
});

describe("cutPolygonAtAntimeridian", () => {
  it("returns an untouched polygon when nothing wraps", () => {
    const polygon: LonLatPolygon = [box(0, 0, 10, 10)];
    const result = cutPolygonAtAntimeridian(polygon);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(polygon);
  });

  it("splits a straddling ring into an east piece and a west piece", () => {
    const result = cutPolygonAtAntimeridian([straddling]);
    expect(result).toHaveLength(2);
    const lonRanges = result.map((poly) => {
      const lons = (poly[0] as LonLatRing).map(([lon]) => lon);
      return [Math.min(...lons), Math.max(...lons)];
    });
    lonRanges.sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(lonRanges[0]).toEqual([-180, -170]);
    expect(lonRanges[1]).toEqual([170, 180]);
  });

  it("leaves every output vertex inside [-180, 180]", () => {
    for (const poly of cutPolygonAtAntimeridian([straddling])) {
      for (const ring of poly) {
        for (const [lon] of ring) {
          expect(lon).toBeGreaterThanOrEqual(-180);
          expect(lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it("emits closed rings with at least four points", () => {
    for (const poly of cutPolygonAtAntimeridian([straddling])) {
      for (const ring of poly) {
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });

  it("preserves total longitude span, so no territory is lost in the cut", () => {
    const spans = cutPolygonAtAntimeridian([straddling]).map((poly) => {
      const lons = (poly[0] as LonLatRing).map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    });
    // The source spans 170->190, i.e. 20 degrees, split as 10 + 10.
    expect(spans.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 9);
  });

  it("carries holes into the band that contains them", () => {
    const polygon: LonLatPolygon = [straddling, box(172, 2, 174, 4)];
    const result = cutPolygonAtAntimeridian(polygon);
    const east = result.find((poly) => (poly[0] as LonLatRing).some(([lon]) => lon > 0));
    expect(east).toHaveLength(2);
  });
});

describe("cutPolygons", () => {
  it("counts how many polygons needed cutting", () => {
    const { polygons, cut } = cutPolygons([[box(0, 0, 10, 10)], [straddling]]);
    expect(cut).toBe(1);
    expect(polygons).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/antimeridian.test.ts`
Expected: FAIL — cannot resolve `../src/stages/antimeridian`.

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/antimeridian.ts`:

```typescript
import type { LonLat, LonLatPolygon, LonLatRing } from "./normalise";

/**
 * A ring crosses the antimeridian when a segment between consecutive vertices
 * jumps more than 180 degrees of longitude, which is how GeoJSON expresses a
 * crossing: 170 followed by -170 is a 20-degree step written as a 340 one.
 */
export function ringWraps(ring: LonLatRing): boolean {
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1] as LonLat;
    const b = ring[i] as LonLat;
    if (Math.abs(b[0] - a[0]) > 180) return true;
  }
  return false;
}

/** Drop the duplicated closing vertex, so clipping treats the ring as a cycle. */
function openRing(ring: LonLatRing): LonLatRing {
  const out = ring.slice();
  const first = out[0] as LonLat;
  const last = out[out.length - 1] as LonLat;
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

function closeRing(ring: LonLatRing): LonLatRing {
  const first = ring[0] as LonLat;
  return [...ring, [first[0], first[1]]];
}

/** Rewrite a ring into continuous longitudes, so 170 -> -170 becomes 170 -> 190. */
function unwrapRing(ring: LonLatRing): LonLatRing {
  const out: LonLatRing = [ring[0] as LonLat];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const prev = ring[i - 1] as LonLat;
    const cur = ring[i] as LonLat;
    const step = cur[0] - prev[0];
    if (step > 180) offset -= 360;
    else if (step < -180) offset += 360;
    out.push([cur[0] + offset, cur[1]]);
  }
  return out;
}

function meanLon(ring: LonLatRing): number {
  let sum = 0;
  for (const [lon] of ring) sum += lon;
  return sum / ring.length;
}

/**
 * Sutherland-Hodgman against one vertical half-plane. Valid for concave input
 * because a half-plane is convex. It can leave zero-area spurs running along
 * the clip line on concave shapes; those lie exactly on the antimeridian at the
 * map's edge and are invisible under any fill rule.
 */
function clipHalfPlane(ring: LonLatRing, bound: number, keepBelow: boolean): LonLatRing {
  const inside = (p: LonLat) => (keepBelow ? p[0] <= bound : p[0] >= bound);
  const out: LonLatRing = [];
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i] as LonLat;
    const prev = ring[(i + ring.length - 1) % ring.length] as LonLat;
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn !== prevIn) {
      const dx = cur[0] - prev[0];
      const t = dx === 0 ? 0 : (bound - prev[0]) / dx;
      out.push([bound, prev[1] + t * (cur[1] - prev[1])]);
    }
    if (curIn) out.push([cur[0], cur[1]]);
  }
  return out;
}

function clipToBand(ring: LonLatRing, lo: number, hi: number): LonLatRing | null {
  const clipped = clipHalfPlane(clipHalfPlane(ring, lo, false), hi, true);
  return clipped.length >= 3 ? clipped : null;
}

/**
 * Split a polygon that crosses the antimeridian into pieces that do not.
 *
 * The cut runs along a meridian at the map's edge and asserts nothing about
 * territory. See docs/decisions/0011-antimeridian-cutting.md. Polygons that do
 * not wrap are returned byte-for-byte untouched.
 */
export function cutPolygonAtAntimeridian(polygon: LonLatPolygon): LonLatPolygon[] {
  if (!polygon.some(ringWraps)) return [polygon];

  const outerSource = polygon[0] as LonLatRing;
  const outer = unwrapRing(openRing(outerSource));
  const outerMean = meanLon(outer);

  const rings: LonLatRing[] = [outer];
  for (let i = 1; i < polygon.length; i++) {
    const hole = unwrapRing(openRing(polygon[i] as LonLatRing));
    // Put the hole in the same 360-degree frame as the outer ring, or it lands
    // in a band the outer ring does not occupy and is silently dropped.
    const shift = Math.round((outerMean - meanLon(hole)) / 360) * 360;
    rings.push(shift === 0 ? hole : hole.map(([lon, lat]) => [lon + shift, lat] as LonLat));
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const ring of rings) {
    for (const [lon] of ring) {
      if (lon < min) min = lon;
      if (lon > max) max = lon;
    }
  }

  const firstBand = Math.floor((min + 180) / 360);
  const lastBand = Math.floor((max + 180) / 360);
  const out: LonLatPolygon[] = [];

  for (let band = firstBand; band <= lastBand; band++) {
    const lo = -180 + 360 * band;
    const hi = 180 + 360 * band;
    const clippedOuter = clipToBand(rings[0] as LonLatRing, lo, hi);
    if (!clippedOuter) continue;

    const shifted: LonLatPolygon = [
      closeRing(clippedOuter.map(([lon, lat]) => [lon - 360 * band, lat] as LonLat)),
    ];
    for (let i = 1; i < rings.length; i++) {
      const clippedHole = clipToBand(rings[i] as LonLatRing, lo, hi);
      if (clippedHole) {
        shifted.push(closeRing(clippedHole.map(([lon, lat]) => [lon - 360 * band, lat] as LonLat)));
      }
    }
    out.push(shifted);
  }

  return out;
}

export function cutPolygons(polygons: LonLatPolygon[]): {
  polygons: LonLatPolygon[];
  cut: number;
} {
  const out: LonLatPolygon[] = [];
  let cut = 0;
  for (const polygon of polygons) {
    const pieces = cutPolygonAtAntimeridian(polygon);
    if (pieces.length > 1 || polygon.some(ringWraps)) cut++;
    out.push(...pieces);
  }
  return { polygons: out, cut };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/antimeridian.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Write the decision record**

`docs/decisions/0011-antimeridian-cutting.md`:

```markdown
# 0011 — Antimeridian-crossing geometry is cut

**Status:** accepted

**This is the only place the pipeline splits geometry. Read it before changing
anything in `stages/antimeridian.ts`.**

## Context

GeoJSON writes a polygon crossing 180 degrees longitude as a jump: 170 followed
by -170. Projected naively into Equal Earth, that segment becomes a line across
the entire map, and the polygon fills as a stripe through every continent
between them. Only a handful of Cliopatria rows are affected, but the artifact
is grossly wrong wherever they are.

## Decision

Rings whose consecutive longitudes jump more than 180 degrees are unwrapped into
continuous longitudes, clipped into 360-degree bands, and shifted back — all in
lon/lat space, before projection. Holes are moved into the outer ring's frame
first so they are not dropped. Polygons that do not wrap are returned untouched.

## Why this is not "inventing geometry"

The project's non-negotiable is never asserting what the data cannot support.
The cut line is a meridian at the map's edge, not a frontier: it carries no
claim about who held what. The alternative asserts something far stronger and
plainly false — that a polity occupied a band across the whole world.

The distinction against clipping to a viewport bbox (deliberately not done, see
the Phase 0 spike's `extract.mjs`) is that a bbox edge cuts through the middle
of the map where a reader reads it as a border. The antimeridian is the seam the
projection already has.

## Consequences

- One polity becomes several polygons in the artifact. Nothing downstream cares:
  geometry is already a list of polygons per version.
- Sutherland-Hodgman can leave zero-area spurs along the cut line on concave
  rings. They sit exactly on the antimeridian and are invisible under any fill
  rule. Accepted rather than adding a general polygon clipper.
- The build reports how many polygons were cut. A sudden change in that count on
  an upstream bump means the source's geometry conventions changed.
- The acceptance criterion "no polygon crosses the antimeridian in projected
  space" is what stops this silently regressing.
```

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline docs/decisions/0011-antimeridian-cutting.md
git commit -m "feat(pipeline): cut antimeridian-crossing geometry, and ADR 0011"
```

---

### Task 12: Project to Equal Earth with bbox and label anchor

Stage 5. Geometry is projected once, at build time, per decision 0002. The per-version bbox is load-bearing for Milestone 2's spatial index and for decision 0006's viewport-scoped `nextVisibleChange`; the label anchor rides along because it is nearly free here and expensive to add later.

**Files:**
- Create: `packages/pipeline/src/stages/project.ts`
- Modify: `packages/pipeline/package.json`
- Test: `packages/pipeline/tests/project.test.ts`

**Interfaces:**
- Consumes: `equalEarth` (Task 4), `COORD_SCALE` (Task 2), `Polygon`, `VersionGeometry` (Task 2), `LonLatPolygon` (Task 8).
- Produces: `projectPolygons(polygons: LonLatPolygon[], scale: number): VersionGeometry` and `projectLand(polygons: LonLatPolygon[], scale: number): Polygon[]`.

- [ ] **Step 1: Add the label-placement dependency**

`polylabel` computes a polygon's pole of inaccessibility — the interior point furthest from any edge — so a label sits inside the shape rather than in a bay. It is MIT, deterministic (a grid subdivision, no randomness), and tiny.

```bash
pnpm --filter @history/pipeline add polylabel
pnpm --filter @history/pipeline add -D @types/polylabel
```

If `@types/polylabel` does not resolve, create `packages/pipeline/src/polylabel.d.ts` instead:

```typescript
declare module "polylabel" {
  export default function polylabel(
    polygon: number[][][],
    precision?: number,
    debug?: boolean,
  ): [number, number] & { distance: number };
}
```

- [ ] **Step 2: Write the failing test**

`packages/pipeline/tests/project.test.ts`:

```typescript
import { COORD_SCALE, equalEarthInverse } from "@history/model";
import { describe, expect, it } from "vitest";
import type { LonLatPolygon } from "../src/stages/normalise";
import { projectLand, projectPolygons } from "../src/stages/project";

const SCALE = COORD_SCALE.full;

const squareAt = (minLon: number, minLat: number, size: number): LonLatPolygon => [
  [
    [minLon, minLat],
    [minLon + size, minLat],
    [minLon + size, minLat + size],
    [minLon, minLat + size],
    [minLon, minLat],
  ],
];

describe("projectPolygons", () => {
  it("emits flat integer rings, two numbers per vertex", () => {
    const { polygons } = projectPolygons([squareAt(0, 0, 10)], SCALE);
    const ring = polygons[0]?.[0] as number[];
    expect(ring).toHaveLength(10);
    expect(ring.every((n) => Number.isInteger(n))).toBe(true);
  });

  it("keeps every vertex un-projectable to its source within 1e-6 degrees", () => {
    const source = squareAt(-30, 40, 12);
    const { polygons } = projectPolygons([source], SCALE);
    const ring = polygons[0]?.[0] as number[];
    const sourceRing = source[0] as Array<[number, number]>;
    for (let i = 0; i < sourceRing.length; i++) {
      const [lon, lat] = sourceRing[i] as [number, number];
      const [backLon, backLat] = equalEarthInverse(
        (ring[i * 2] as number) / SCALE,
        (ring[i * 2 + 1] as number) / SCALE,
      );
      expect(Math.abs(backLon - lon)).toBeLessThan(1e-6);
      expect(Math.abs(backLat - lat)).toBeLessThan(1e-6);
    }
  });

  it("computes a bbox enclosing every vertex of every polygon", () => {
    const { polygons, bbox } = projectPolygons(
      [squareAt(0, 0, 5), squareAt(20, 20, 5)],
      SCALE,
    );
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 2) {
          expect(ring[i] as number).toBeGreaterThanOrEqual(bbox[0]);
          expect(ring[i] as number).toBeLessThanOrEqual(bbox[2]);
          expect(ring[i + 1] as number).toBeGreaterThanOrEqual(bbox[1]);
          expect(ring[i + 1] as number).toBeLessThanOrEqual(bbox[3]);
        }
      }
    }
  });

  it("places the label anchor inside the bbox", () => {
    const { bbox, anchor } = projectPolygons([squareAt(0, 0, 10)], SCALE);
    expect(anchor[0]).toBeGreaterThan(bbox[0]);
    expect(anchor[0]).toBeLessThan(bbox[2]);
    expect(anchor[1]).toBeGreaterThan(bbox[1]);
    expect(anchor[1]).toBeLessThan(bbox[3]);
  });

  it("anchors on the largest polygon, not the first one listed", () => {
    const { anchor } = projectPolygons([squareAt(0, 0, 1), squareAt(40, 0, 20)], SCALE);
    const [lon] = equalEarthInverse(anchor[0] / SCALE, anchor[1] / SCALE);
    expect(lon).toBeGreaterThan(30);
  });

  it("is deterministic: the same input yields identical output", () => {
    const input = [squareAt(0, 0, 10), squareAt(30, -20, 7)];
    expect(projectPolygons(input, SCALE)).toEqual(projectPolygons(input, SCALE));
  });
});

describe("projectLand", () => {
  it("projects land polygons without bbox or anchor", () => {
    const polygons = projectLand([squareAt(0, 0, 10)], COORD_SCALE.coarse);
    expect(polygons[0]?.[0]).toHaveLength(10);
  });
});
```

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/project.ts`:

```typescript
import { equalEarth } from "@history/model";
import type { Polygon, Ring, VersionGeometry } from "@history/model";
import polylabel from "polylabel";
import type { LonLatPolygon } from "./normalise";

/** Project a polygon's rings to unrounded projected [x, y] pairs. */
function projectRings(polygon: LonLatPolygon): number[][][] {
  return polygon.map((ring) => ring.map(([lon, lat]) => equalEarth(lon, lat) as number[]));
}

/** Shoelace area of a projected outer ring. Equal Earth is equal-area, so this
 *  ranks polygons by real territorial extent. */
function ringArea(ring: number[][]): number {
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as number[];
    const q = ring[(i + 1) % ring.length] as number[];
    acc += (p[0] as number) * (q[1] as number) - (q[0] as number) * (p[1] as number);
  }
  return Math.abs(acc) / 2;
}

function flatten(rings: number[][][], scale: number): Polygon {
  return rings.map((ring) => {
    const flat: Ring = new Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      const point = ring[i] as number[];
      flat[i * 2] = Math.round((point[0] as number) * scale);
      flat[i * 2 + 1] = Math.round((point[1] as number) * scale);
    }
    return flat;
  });
}

export function projectPolygons(polygons: LonLatPolygon[], scale: number): VersionGeometry {
  if (polygons.length === 0) throw new Error("projectPolygons requires at least one polygon");
  const projected = polygons.map(projectRings);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rings of projected) {
    for (const ring of rings) {
      for (const point of ring) {
        const x = point[0] as number;
        const y = point[1] as number;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  // The anchor goes on the largest piece, so an empire's label lands on its
  // mainland rather than on an offshore island that happened to be listed first.
  let largest = projected[0] as number[][][];
  let largestArea = -1;
  for (const rings of projected) {
    const area = ringArea(rings[0] as number[][]);
    if (area > largestArea) {
      largestArea = area;
      largest = rings;
    }
  }
  const anchor = polylabel(largest, 1e-4);

  return {
    polygons: projected.map((rings) => flatten(rings, scale)),
    bbox: [
      Math.round(minX * scale),
      Math.round(minY * scale),
      Math.round(maxX * scale),
      Math.round(maxY * scale),
    ],
    anchor: [Math.round((anchor[0] as number) * scale), Math.round((anchor[1] as number) * scale)],
  };
}

/** Land needs no bbox or anchor: it is one static backdrop, never labelled. */
export function projectLand(polygons: LonLatPolygon[], scale: number): Polygon[] {
  return polygons.map((polygon) => flatten(projectRings(polygon), scale));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/project.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline package.json pnpm-lock.yaml
git commit -m "feat(pipeline): project to Equal Earth with bbox and label anchor"
```

---

### Task 13: Emit artifacts and the manifest

Stage 6. Every artifact goes through the deterministic writer, and the manifest names every source with its upstream version and licence — an acceptance criterion, and the Cliopatria CC-BY attribution obligation from `docs/standards.md`.

**Files:**
- Create: `packages/pipeline/src/stages/emit.ts`
- Test: `packages/pipeline/tests/emit.test.ts`

**Interfaces:**
- Consumes: `writeArtifact` (Task 5), `SCHEMA_VERSION`, `COORD_SCALE`, `PROJECTION`, artifact types (Task 2), `SourceSpec` (Task 6).
- Produces: `EmitInput`, `emit(input: EmitInput): Manifest`.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/emit.test.ts`:

```typescript
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COORD_SCALE, type Manifest, readArtifact, type VersionsArtifact } from "@history/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emit } from "../src/stages/emit";
import type { SourceSpec } from "../src/sources";

const source: SourceSpec = {
  dataset: "cliopatria",
  name: "Cliopatria (Seshat Global History Databank)",
  license: "CC-BY-4.0",
  upstreamVersion: "1.0.0",
  url: "https://example.invalid/c.zip",
  file: "c.zip",
  sha256: "a".repeat(64),
};

function input(outDir: string) {
  return {
    outDir,
    polities: [
      {
        id: "wd:Q1",
        name: "P",
        normalizedName: "p",
        wikidata: "Q1",
        wikipedia: null,
        seshat: null,
      },
    ],
    versions: [
      {
        id: "wd:Q1@0",
        polityId: "wd:Q1",
        fromYear: 0,
        toYear: 100,
        area: 5,
        prevId: null,
        delta: null,
        gap: null,
        confidence: null,
        source: { dataset: "cliopatria" as const, version: "1.0.0" },
      },
    ],
    geometry: {
      "wd:Q1@0": {
        polygons: [[[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]]],
        bbox: [0, 0, 10, 10] as [number, number, number, number],
        anchor: [5, 5] as [number, number],
      },
    },
    land: { coarse: [[[0, 0, 1, 0, 1, 1, 0, 0]]], mid: [[[0, 0, 2, 0, 2, 2, 0, 0]]] },
    sources: [source],
  };
}

describe("emit", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "emit-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the Milestone 1 artifact set", () => {
    emit(input(dir));
    for (const file of [
      "polities.json",
      "versions.2.json",
      "land.0.json",
      "land.1.json",
      "manifest.json",
    ]) {
      expect(readFileSync(join(dir, file), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("stamps the versions artifact with its level and coordinate scale", () => {
    emit(input(dir));
    const artifact = readArtifact<VersionsArtifact>(join(dir, "versions.2.json"));
    expect(artifact.level).toBe("full");
    expect(artifact.coordScale).toBe(COORD_SCALE.full);
    expect(artifact.rows).toHaveLength(1);
    expect(artifact.geometry["wd:Q1@0"]?.anchor).toEqual([5, 5]);
  });

  it("names every source with its upstream version and licence", () => {
    emit(input(dir));
    const manifest = readArtifact<Manifest>(join(dir, "manifest.json"));
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.sources[0]).toMatchObject({
      dataset: "cliopatria",
      license: "CC-BY-4.0",
      upstreamVersion: "1.0.0",
      sha256: "a".repeat(64),
    });
  });

  it("records size and checksum for every artifact except the manifest itself", () => {
    const manifest = emit(input(dir));
    const files = manifest.artifacts.map((a) => a.file);
    expect(files).toEqual(["land.0.json", "land.1.json", "polities.json", "versions.2.json"]);
    for (const artifact of manifest.artifacts) {
      expect(artifact.bytes).toBeGreaterThan(0);
      expect(artifact.gzipBytes).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("writes no wall-clock time anywhere in the output", () => {
    emit(input(dir));
    for (const file of ["manifest.json", "polities.json", "versions.2.json"]) {
      const raw = readFileSync(join(dir, file), "utf8");
      expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    }
  });

  it("refuses to emit against an unpinned source", () => {
    const unpinned = { ...input(dir), sources: [{ ...source, sha256: null }] };
    expect(() => emit(unpinned)).toThrow(/unpinned/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/emit.test.ts`
Expected: FAIL — cannot resolve `../src/stages/emit`.

- [ ] **Step 3: Write the implementation**

`packages/pipeline/src/stages/emit.ts`:

```typescript
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  COORD_SCALE,
  type LandArtifact,
  type Manifest,
  type ManifestArtifact,
  type ManifestSource,
  PROJECTION,
  type Polity,
  type Polygon,
  SCHEMA_VERSION,
  type Version,
  type VersionGeometry,
  type VersionsArtifact,
  type PolitiesArtifact,
  writeArtifact,
} from "@history/model";
import type { SourceSpec } from "../sources";

export interface EmitInput {
  outDir: string;
  polities: Polity[];
  versions: Version[];
  geometry: Record<string, VersionGeometry>;
  land: { coarse: Polygon[]; mid: Polygon[] };
  sources: SourceSpec[];
}

function measure(outDir: string, file: string): ManifestArtifact {
  const buf = readFileSync(join(outDir, file));
  return {
    file,
    bytes: buf.length,
    gzipBytes: gzipSync(buf, { level: 9 }).length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

/**
 * Write the Milestone 1 artifact set, then the manifest that describes it.
 *
 * The manifest deliberately carries no build time. Provenance is the upstream
 * versions and checksums, which are properties of the inputs; a timestamp is a
 * property of the run and would break byte-identical output. See ADR 0010.
 */
export function emit(input: EmitInput): Manifest {
  mkdirSync(input.outDir, { recursive: true });

  const sources: ManifestSource[] = input.sources
    .map((spec) => {
      if (spec.sha256 === null) {
        throw new Error(
          `Cannot emit: source "${spec.dataset}" is unpinned. Run fetch --write-pins and commit ` +
            "the checksum before building.",
        );
      }
      return {
        dataset: spec.dataset,
        name: spec.name,
        license: spec.license,
        upstreamVersion: spec.upstreamVersion,
        url: spec.url,
        sha256: spec.sha256,
      };
    })
    .sort((a, b) => (a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : 0));

  const polities: PolitiesArtifact = {
    schemaVersion: SCHEMA_VERSION,
    polities: input.polities,
  };
  const versions: VersionsArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "full",
    coordScale: COORD_SCALE.full,
    rows: input.versions,
    geometry: input.geometry,
  };
  const landCoarse: LandArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "coarse",
    coordScale: COORD_SCALE.coarse,
    polygons: input.land.coarse,
  };
  const landMid: LandArtifact = {
    schemaVersion: SCHEMA_VERSION,
    level: "mid",
    coordScale: COORD_SCALE.mid,
    polygons: input.land.mid,
  };

  writeArtifact(join(input.outDir, "polities.json"), polities);
  writeArtifact(join(input.outDir, "versions.2.json"), versions);
  writeArtifact(join(input.outDir, "land.0.json"), landCoarse);
  writeArtifact(join(input.outDir, "land.1.json"), landMid);

  // Sorted so the manifest is stable regardless of write order.
  const files = ["land.0.json", "land.1.json", "polities.json", "versions.2.json"];
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    projection: PROJECTION,
    sources,
    artifacts: files.map((file) => measure(input.outDir, file)),
  };
  writeArtifact(join(input.outDir, "manifest.json"), manifest);
  return manifest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/pipeline/tests/emit.test.ts && pnpm typecheck`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline
git commit -m "feat(pipeline): emit artifacts and a provenance manifest"
```

---

### Task 14: Build orchestration and the CLI

Composes the stages in memory. Fetch stays a separate cached command so the pure transform can be iterated on without touching the network — `docs/phase-1-design.md` D6.

**Files:**
- Create: `packages/pipeline/src/build.ts`
- Modify: `packages/pipeline/src/cli.ts`
- Test: `packages/pipeline/tests/build.test.ts`

**Interfaces:**
- Consumes: every stage from Tasks 6 and 8-13.
- Produces: `BuildOptions` (`{ sourcesDir: string; outDir: string; aliases: AliasEntry[]; overlaps: OverlapWhitelistEntry[] }`), `BuildReport`, `build(options: BuildOptions): BuildReport`, `loadAliases(path): AliasEntry[]`, `loadOverlaps(path): OverlapWhitelistEntry[]`.

- [ ] **Step 1: Write the failing test**

`packages/pipeline/tests/build.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Manifest, readArtifact, type VersionsArtifact } from "@history/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { build } from "../src/build";

const ring = (cx: number, cy: number) => [
  [cx, cy],
  [cx + 2, cy],
  [cx + 2, cy + 2],
  [cx, cy + 2],
  [cx, cy],
];

function collection(features: unknown[]) {
  return JSON.stringify({ type: "FeatureCollection", features });
}

function feature(props: Record<string, unknown>, cx: number, cy: number) {
  return {
    type: "Feature",
    properties: { Type: "POLITY", Area: 1, ...props },
    geometry: { type: "Polygon", coordinates: [ring(cx, cy)] },
  };
}

describe("build", () => {
  let sourcesDir: string;
  let outDir: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "build-"));
    sourcesDir = join(root, "sources");
    outDir = join(root, "dist");
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(
      join(sourcesDir, "cliopatria.geojson"),
      collection([
        feature({ Name: "Alpha", Wikidata: "Q1", FromYear: 0, ToYear: 100 }, 0, 0),
        feature({ Name: "Alpha", Wikidata: "Q1", FromYear: 150, ToYear: 200 }, 1, 1),
        feature({ Name: "Beta", FromYear: -50, ToYear: 20 }, 20, 20),
        { ...feature({ Name: "Rel", FromYear: 0, ToYear: 1 }, 5, 5), properties: { Type: "RELATION" } },
      ]),
    );
    const land = collection([
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(0, 0)] } },
    ]);
    writeFileSync(join(sourcesDir, "ne_110m_land.geojson"), land);
    writeFileSync(join(sourcesDir, "ne_50m_land.geojson"), land);
  });

  afterEach(() => {
    rmSync(join(sourcesDir, ".."), { recursive: true, force: true });
  });

  it("produces the Milestone 1 artifact set end to end", () => {
    const report = build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    expect(report.normalise.kept).toBe(3);
    expect(report.normalise.droppedNonPolity).toBe(1);
    expect(report.polities).toBe(2);
    expect(report.versions).toBe(3);

    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    expect(Object.keys(versions.geometry)).toHaveLength(3);
    const second = versions.rows.find((r) => r.id === "wd:Q1@150");
    expect(second?.prevId).toBe("wd:Q1@0");
    expect(second?.gap).toBe(50);
  });

  it("attaches geometry to every version it emits", () => {
    build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
    for (const row of versions.rows) {
      expect(versions.geometry[row.id]).toBeDefined();
    }
  });

  it("copies source provenance into the manifest", () => {
    build({ sourcesDir, outDir, aliases: [], overlaps: [] });
    const manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
    expect(manifest.sources.map((s) => s.dataset).sort()).toEqual([
      "cliopatria",
      "naturalEarth110mLand",
      "naturalEarth50mLand",
    ]);
  });
});
```

> **Note:** this test builds against the real `SOURCES` pins, so Task 7 must be complete. If `SOURCES` still holds `null` checksums the emit stage will refuse, which is the intended behaviour.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/pipeline/tests/build.test.ts`
Expected: FAIL — cannot resolve `../src/build`.

- [ ] **Step 3: Write `packages/pipeline/src/build.ts`**

```typescript
import { readFileSync } from "node:fs";
import { COORD_SCALE } from "@history/model";
import type { VersionGeometry } from "@history/model";
import { SOURCES, type SourceSpec, sourcePath } from "./sources";
import { cutPolygons } from "./stages/antimeridian";
import { emit } from "./stages/emit";
import { type AliasEntry, assignIdentity } from "./stages/identity";
import { deriveLineage, type OverlapWhitelistEntry } from "./stages/lineage";
import {
  type NormaliseReport,
  type NormalisedRow,
  normaliseCliopatria,
  normaliseLand,
} from "./stages/normalise";
import { projectLand, projectPolygons } from "./stages/project";

export interface BuildOptions {
  sourcesDir: string;
  outDir: string;
  aliases: AliasEntry[];
  overlaps: OverlapWhitelistEntry[];
}

export interface BuildReport {
  normalise: NormaliseReport;
  polities: number;
  versions: number;
  overlaps: number;
  polygonsCut: number;
  landPolygons: { coarse: number; mid: number };
}

function readCollection(path: string): unknown[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { features?: unknown };
  if (!Array.isArray(parsed.features)) {
    throw new Error(`${path} is not a GeoJSON FeatureCollection`);
  }
  return parsed.features;
}

export function loadAliases(path: string): AliasEntry[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { aliases: AliasEntry[] }).aliases;
}

export function loadOverlaps(path: string): OverlapWhitelistEntry[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { overlaps: OverlapWhitelistEntry[] }).overlaps;
}

/**
 * The Milestone 1 pipeline, in memory end to end. Fetch is deliberately not
 * called from here: it is a separate cached command, so iterating on the
 * transform never re-downloads.
 */
export function build(options: BuildOptions): BuildReport {
  const cliopatria = SOURCES.cliopatria as SourceSpec;
  const ne110 = SOURCES.naturalEarth110mLand as SourceSpec;
  const ne50 = SOURCES.naturalEarth50mLand as SourceSpec;

  const { rows, report } = normaliseCliopatria(
    readCollection(sourcePath(cliopatria, options.sourcesDir)),
  );
  const { polities, rowPolityIds } = assignIdentity(rows, options.aliases);
  const { versions, overlaps, rowIndexById } = deriveLineage(
    rows,
    rowPolityIds,
    options.overlaps,
    cliopatria.upstreamVersion,
  );

  const geometry: Record<string, VersionGeometry> = {};
  let polygonsCut = 0;
  for (const version of versions) {
    const row = rows[rowIndexById[version.id] as number] as NormalisedRow;
    const cut = cutPolygons(row.polygons);
    polygonsCut += cut.cut;
    geometry[version.id] = projectPolygons(cut.polygons, COORD_SCALE.full);
  }

  const coarse = projectLand(
    cutPolygons(normaliseLand(readCollection(sourcePath(ne110, options.sourcesDir))).polygons)
      .polygons,
    COORD_SCALE.coarse,
  );
  const mid = projectLand(
    cutPolygons(normaliseLand(readCollection(sourcePath(ne50, options.sourcesDir))).polygons)
      .polygons,
    COORD_SCALE.mid,
  );

  emit({
    outDir: options.outDir,
    polities,
    versions,
    geometry,
    land: { coarse, mid },
    sources: [cliopatria, ne110, ne50],
  });

  return {
    normalise: report,
    polities: polities.length,
    versions: versions.length,
    overlaps: overlaps.length,
    polygonsCut,
    landPolygons: { coarse: coarse.length, mid: mid.length },
  };
}
```

- [ ] **Step 4: Add the build subcommand to the CLI**

Replace the command dispatch at the bottom of `packages/pipeline/src/cli.ts`, and add this function above it:

```typescript
import { build, loadAliases, loadOverlaps } from "./build";

function runBuild(): void {
  const sourcesDir = option("sources", "data/sources");
  const outDir = option("out", "dist");
  const report = build({
    sourcesDir,
    outDir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });

  const n = report.normalise;
  console.log(`\n  ${report.polities} polities, ${report.versions} versions -> ${outDir}`);
  console.log(
    `  Dropped: ${n.droppedNonPolity} non-POLITY, ${n.droppedYears} bad years, ` +
      `${n.droppedGeometry} bad geometry. Closed ${n.closedRings} open rings.`,
  );
  console.log(`  Antimeridian: ${report.polygonsCut} polygons cut.`);
  console.log(`  Overlaps (whitelisted): ${report.overlaps}.`);
  console.log(
    `  Land: ${report.landPolygons.coarse} coarse, ${report.landPolygons.mid} mid.\n`,
  );
}

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else if (command === "build") {
  runBuild();
} else {
  console.error(`Unknown command "${command ?? ""}". Known: fetch, build`);
  process.exit(1);
}
```

Raise the heap for the real dataset by changing the root `package.json` build script:

```json
"build": "NODE_OPTIONS=--max-old-space-size=8192 tsx packages/pipeline/src/cli.ts build"
```

- [ ] **Step 5: Run test to verify it passes, then build for real**

```bash
pnpm vitest run packages/pipeline/tests/build.test.ts
pnpm build
```

Expected: tests PASS (3 tests). The real build prints its report and writes `dist/`. If it throws on duplicate `from_year` or unwhitelisted overlaps, that is the pipeline working — read the listed ids, decide whether each is a data error or a real co-existence, and either add an alias to `aliases.json` or an entry to `overlaps.json` **with a reason**. Re-run until it completes.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline package.json
git commit -m "feat(pipeline): compose the build pipeline behind a CLI"
```

---

### Task 15: Extract and commit the test fixture

The committed fixture is a deterministic carve of the real dataset. It has to exercise the hard cases, not merely be small: dense lineage chains, multipolygons, `RELATION` rows for the filter to drop, and geometry near the antimeridian.

**Files:**
- Create: `packages/pipeline/src/stages/extract-fixture.ts`, `fixtures/README.md`
- Modify: `packages/pipeline/src/cli.ts`
- Create (generated, committed): `fixtures/cliopatria.geojson`, `fixtures/ne_110m_land.geojson`, `fixtures/ne_50m_land.geojson`

**Interfaces:**
- Consumes: nothing from earlier tasks; it works on raw GeoJSON.
- Produces: `FIXTURE_BBOX`, `ANTIMERIDIAN_LON`, `selectFeatures(features: unknown[]): unknown[]`.

- [ ] **Step 1: Write the extractor**

`packages/pipeline/src/stages/extract-fixture.ts`:

```typescript
/**
 * Carve a committed test slice out of the fetched dataset.
 *
 * Selection is by vertex, never by bounding box. A polygon crossing the
 * antimeridian has a lon/lat bounding box spanning the entire world, so a
 * bbox test would drag every wrapping polygon into every region's slice.
 */

/** Central Mediterranean: Italy, Greece, the Adriatic and the African coast. */
export const FIXTURE_BBOX: [number, number, number, number] = [5, 34, 30, 47];

/** Anything this close to 180 degrees is near or across the antimeridian. */
export const ANTIMERIDIAN_LON = 170;

function visitVertices(geometry: unknown, visit: (lon: number, lat: number) => boolean): boolean {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  if (!g) return false;
  const groups =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? (g.coordinates as unknown[])
        : [];
  for (const group of groups) {
    if (!Array.isArray(group)) continue;
    for (const ring of group) {
      if (!Array.isArray(ring)) continue;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        if (Number.isFinite(lon) && Number.isFinite(lat) && visit(lon, lat)) return true;
      }
    }
  }
  return false;
}

export function selectFeatures(features: unknown[]): unknown[] {
  const [minLon, minLat, maxLon, maxLat] = FIXTURE_BBOX;
  return features.filter((feature) =>
    visitVertices(
      (feature as { geometry?: unknown }).geometry,
      (lon, lat) =>
        Math.abs(lon) >= ANTIMERIDIAN_LON ||
        (lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat),
    ),
  );
}
```

`Type` is deliberately not filtered: the fixture keeps `RELATION` rows so the normalise stage's filter has something real to drop.

- [ ] **Step 2: Add the subcommand**

Add to `packages/pipeline/src/cli.ts`, and extend the dispatch with `else if (command === "extract-fixture") runExtractFixture();` and the usage line:

```typescript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectFeatures } from "./stages/extract-fixture";

function runExtractFixture(): void {
  const sourcesDir = option("sources", "data/sources");
  const outDir = option("out", "fixtures");
  mkdirSync(outDir, { recursive: true });

  for (const file of ["cliopatria.geojson", "ne_110m_land.geojson", "ne_50m_land.geojson"]) {
    const parsed = JSON.parse(readFileSync(join(sourcesDir, file), "utf8")) as {
      features: unknown[];
    };
    const features = selectFeatures(parsed.features);
    // Not the artifact writer: this is source-shaped GeoJSON, not an artifact.
    writeFileSync(
      join(outDir, file),
      `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    );
    console.log(`  ${file}: ${features.length} of ${parsed.features.length} features`);
  }
}
```

- [ ] **Step 3: Generate the fixture and check its size**

```bash
NODE_OPTIONS=--max-old-space-size=8192 pnpm extract-fixture
du -h fixtures/*.geojson
```

Expected: three files, well under 1 MB in total. **If the total exceeds 1.5 MB**, tighten `FIXTURE_BBOX` (for example to Italy alone, `[8, 36, 19, 47]`), re-run, and record the final box in `fixtures/README.md`.

Confirm it exercises the hard cases:

```bash
python3 -c "
import json

def vertices(geom):
    groups = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for rings in groups:
        for ring in rings:
            for point in ring:
                yield point

features = json.load(open('fixtures/cliopatria.geojson'))['features']
types, multi, near_anti, wrapping = {}, 0, 0, 0
for f in features:
    t = (f.get('properties') or {}).get('Type')
    types[t] = types.get(t, 0) + 1
    if f['geometry']['type'] == 'MultiPolygon':
        multi += 1
    lons = [p[0] for p in vertices(f['geometry'])]
    if any(abs(lon) >= 170 for lon in lons):
        near_anti += 1
    if any(abs(b - a) > 180 for a, b in zip(lons, lons[1:])):
        wrapping += 1

print('features:', len(features))
print('Type counts:', types)
print('MultiPolygons:', multi)
print('near the antimeridian:', near_anti)
print('actually wrapping:', wrapping)
"
```

Expected: both `POLITY` and `RELATION` present, at least one MultiPolygon, and a non-zero count near the antimeridian. If no `RELATION` row survives the carve, widen `FIXTURE_BBOX` slightly until one does — the drop-count test needs it. If `actually wrapping` is zero the antimeridian test still has near-edge geometry to check but nothing to cut; that is acceptable, since Task 11 covers cutting exhaustively with synthetic rings.

- [ ] **Step 4: Write `fixtures/README.md`**

```markdown
# Fixtures

A deterministic carve of the real, pinned upstream data. Committed so tests and
a first run work without a 100 MB download.

Regenerate with `pnpm extract-fixture` after `pnpm fetch`. Regeneration is a
deliberate act — it happens when an upstream pin changes, and the diff is
reviewed.

## Selection

By vertex, never by bounding box: a polygon crossing the antimeridian has a
lon/lat bounding box spanning the whole world, so a bbox test would pull every
wrapping polygon into every slice.

A feature is kept when any vertex is either

- inside the central Mediterranean box `[5, 34, 30, 47]` — the densest part of
  the dataset, so lineage chains and multipolygons are well represented; or
- at longitude 170 or beyond in absolute value — so antimeridian cutting has
  real geometry to work on.

`RELATION` rows are deliberately **not** filtered out. The normalise stage's
`POLITY` filter needs something real to drop.

## `dist/`

Golden build output for this slice. Regenerate with `pnpm fixture:bless`. An
unexplained diff here is a regression: the determinism acceptance criterion is
enforced by comparing a fresh build against these files.
```

- [ ] **Step 5: Commit**

```bash
git add fixtures packages/pipeline
git commit -m "feat(pipeline): extract-fixture command and the committed test slice"
```

---

### Task 16: The acceptance-criteria suite and golden artifacts

Every Milestone 1 criterion from `docs/phase-1-importer.md` becomes a named test, run against a real build of the committed fixture. `docs/standards.md` requires the test to be named after the criterion it enforces.

**Files:**
- Create: `packages/pipeline/tests/acceptance.test.ts`
- Modify: `package.json` (add `fixture:bless`)
- Create (generated, committed): `fixtures/dist/*`

**Interfaces:**
- Consumes: `build` (Task 14), `equalEarth` / `equalEarthInverse` (Task 4), `COORD_SCALE` / `MAX_SEGMENT_X` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the acceptance suite**

`packages/pipeline/tests/acceptance.test.ts`:

```typescript
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COORD_SCALE,
  equalEarth,
  equalEarthInverse,
  MAX_SEGMENT_X,
  type Manifest,
  type PolitiesArtifact,
  readArtifact,
  type Version,
  type VersionsArtifact,
} from "@history/model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, loadAliases, loadOverlaps } from "../src/build";

const SCALE = COORD_SCALE.full;
const FIXTURES = "fixtures";

let outDir: string;
let versions: VersionsArtifact;
let polities: PolitiesArtifact;
let manifest: Manifest;

function buildFixtureInto(dir: string) {
  return build({
    sourcesDir: FIXTURES,
    outDir: dir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "acceptance-"));
  buildFixtureInto(outDir);
  versions = readArtifact<VersionsArtifact>(join(outDir, "versions.2.json"));
  polities = readArtifact<PolitiesArtifact>(join(outDir, "polities.json"));
  manifest = readArtifact<Manifest>(join(outDir, "manifest.json"));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const byId = () => new Map(versions.rows.map((v) => [v.id, v] as const));

describe("lineage", () => {
  it("every version has non-null prev_id, delta and gap, except first appearances which have all three null", () => {
    for (const v of versions.rows) {
      const nulls = [v.prevId, v.delta, v.gap].filter((x) => x === null).length;
      expect(nulls === 0 || nulls === 3).toBe(true);
    }
  });

  it("no polity has two versions with the same from_year", () => {
    const seen = new Set<string>();
    for (const v of versions.rows) {
      const key = `${v.polityId}@${v.fromYear}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("overlapping versions of one polity are zero, or explicitly whitelisted with a reason", () => {
    const whitelisted = new Set(
      loadOverlaps("packages/pipeline/overlaps.json").map((o) => `${o.earlier}|${o.later}`),
    );
    for (const o of loadOverlaps("packages/pipeline/overlaps.json")) {
      expect(o.reason.trim().length).toBeGreaterThan(0);
    }
    const index = byId();
    for (const v of versions.rows) {
      if (v.prevId === null) continue;
      const prev = index.get(v.prevId) as Version;
      if (v.fromYear <= prev.toYear) {
        expect(whitelisted.has(`${prev.id}|${v.id}`)).toBe(true);
      }
    }
  });

  it("delta equals area minus prev.area for every non-first version", () => {
    const index = byId();
    for (const v of versions.rows) {
      if (v.prevId === null) continue;
      const prev = index.get(v.prevId) as Version;
      expect(v.delta).toBeCloseTo(v.area - prev.area, 9);
      expect(v.gap).toBe(Math.max(0, v.fromYear - prev.toYear));
    }
  });
});

describe("geometry", () => {
  it("every ring is closed, has at least 4 points, and contains no NaN or infinite values", () => {
    for (const geometry of Object.values(versions.geometry)) {
      expect(geometry.polygons.length).toBeGreaterThan(0);
      for (const polygon of geometry.polygons) {
        for (const ring of polygon) {
          expect(ring.length % 2).toBe(0);
          expect(ring.length / 2).toBeGreaterThanOrEqual(4);
          expect(ring.every(Number.isFinite)).toBe(true);
          expect(ring[0]).toBe(ring[ring.length - 2]);
          expect(ring[1]).toBe(ring[ring.length - 1]);
        }
      }
    }
  });

  it("un-projecting any coordinate returns the source lon/lat within 1e-6", () => {
    // The exhaustive source-to-stored-to-source comparison lives in
    // packages/model/tests/projection.test.ts, which sweeps the globe through
    // this exact COORD_SCALE.full quantisation. Here the same property is
    // checked on the shipped artifact: every stored coordinate must un-project
    // to a real lon/lat and re-project to the identical integer, which is what
    // fails if the scale or the projection ever drift apart.
    for (const geometry of Object.values(versions.geometry)) {
      for (const polygon of geometry.polygons) {
        for (const ring of polygon) {
          for (let i = 0; i < ring.length; i += 2) {
            const x = (ring[i] as number) / SCALE;
            const y = (ring[i + 1] as number) / SCALE;
            const [lon, lat] = equalEarthInverse(x, y);
            expect(Math.abs(lon)).toBeLessThanOrEqual(180.000001);
            expect(Math.abs(lat)).toBeLessThanOrEqual(90.000001);
            const [rx, ry] = equalEarth(lon, lat);
            expect(Math.abs(Math.round(rx * SCALE) - (ring[i] as number))).toBeLessThanOrEqual(1);
            expect(Math.abs(Math.round(ry * SCALE) - (ring[i + 1] as number))).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("no polygon crosses the antimeridian in projected space", () => {
    const limit = MAX_SEGMENT_X * SCALE;
    for (const geometry of Object.values(versions.geometry)) {
      for (const polygon of geometry.polygons) {
        for (const ring of polygon) {
          for (let i = 2; i < ring.length; i += 2) {
            expect(Math.abs((ring[i] as number) - (ring[i - 2] as number))).toBeLessThan(limit);
          }
        }
      }
    }
  });
});

describe("identity and honesty", () => {
  it("polity identity keys on the wikidata id and falls back to the normalised name", () => {
    for (const p of polities.polities) {
      if (p.wikidata !== null) expect(p.id).toBe(`wd:${p.wikidata}`);
      else expect(p.id).toBe(`name:${p.normalizedName}`);
    }
  });

  it("confidence is unpopulated, because it has no licensed source (decision 0005)", () => {
    for (const v of versions.rows) expect(v.confidence).toBeNull();
  });
});

describe("build", () => {
  it("is deterministic: identical inputs produce byte-identical outputs", () => {
    const second = mkdtempSync(join(tmpdir(), "acceptance-2-"));
    try {
      buildFixtureInto(second);
      const files = readdirSync(outDir).sort();
      expect(readdirSync(second).sort()).toEqual(files);
      for (const file of files) {
        expect(readFileSync(join(second, file))).toEqual(readFileSync(join(outDir, file)));
      }
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it("the manifest names every source with its upstream version and licence", () => {
    expect(manifest.sources.length).toBeGreaterThanOrEqual(3);
    for (const source of manifest.sources) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.license.length).toBeGreaterThan(0);
      expect(source.upstreamVersion).not.toBe("UNPINNED");
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.sources.some((s) => s.license === "CC-BY-4.0")).toBe(true);
  });

  it("matches the committed golden artifacts", () => {
    for (const file of readdirSync(join(FIXTURES, "dist")).sort()) {
      expect(readFileSync(join(outDir, file))).toEqual(
        readFileSync(join(FIXTURES, "dist", file)),
      );
    }
  });
});
```

- [ ] **Step 2: Add the bless script**

In the root `package.json` scripts:

```json
"fixture:bless": "rm -rf fixtures/dist && tsx packages/pipeline/src/cli.ts build --sources=fixtures --out=fixtures/dist"
```

- [ ] **Step 3: Generate the golden artifacts, then run the suite**

```bash
pnpm fixture:bless
pnpm vitest run packages/pipeline/tests/acceptance.test.ts
```

Expected: PASS, 11 tests. A failure in "matches the committed golden artifacts" on a first run means `fixture:bless` was not re-run after a code change — inspect the diff before re-blessing, because that diff is the regression signal.

- [ ] **Step 4: Run everything**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add fixtures packages/pipeline package.json
git commit -m "test: acceptance criteria suite and golden fixture artifacts"
```

---

### Task 17: Project documentation

`README.md` is still the Phase 0 spike readme. Public open-source release is the stated goal, so this is the phase the project gets the documentation a contributor expects.

**Files:**
- Rewrite: `README.md`
- Create: `docs/architecture.md`, `CONTRIBUTING.md`, `packages/model/README.md`, `packages/pipeline/README.md`

**Interfaces:**
- Consumes: everything built so far, as subject matter.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `README.md`**

Replace it entirely. Cover, in this order:

1. **What this is** — an interactive map of political territory over time. One paragraph.
2. **The non-negotiable** — quote `docs/standards.md`: never assert something the data cannot support. Then the concrete consequences: no interpolated geometry, no fabricated confidence values, gaps render as gaps.
3. **Status** — Phase 0 closed, Phase 1 Milestone 1 complete: the pipeline produces validated `dist/` artifacts. Phase 2 (the viewer) not started.
4. **Quickstart:**

```bash
nvm use          # Node 22
pnpm install
pnpm fetch       # downloads and checksum-verifies the pinned sources into data/
pnpm build       # writes dist/
pnpm test
```

5. **Layout** — the tree from `docs/phase-1-design.md`, trimmed to what exists.
6. **Where to read more** — `docs/architecture.md` first, then `docs/decisions/` (note that 0008 answers "why not historical-basemaps"), the phase specs, `docs/data-sources.md`, `docs/standards.md`.
7. **Attribution** — Cliopatria, Seshat Global History Databank, Turchin et al., CC-BY, <https://doi.org/10.5281/zenodo.13363121>. Natural Earth, public domain, <https://www.naturalearthdata.com/>. Note that attribution also ships in `dist/manifest.json` and will ship in the UI, per `docs/standards.md`.
8. **Licence** — MIT, and the note from decision 0005 that adopting `historical-basemaps` later would make the project GPL-3.0.

- [ ] **Step 2: Write `docs/architecture.md`**

The narrative a new contributor reads first. Sections:

- **The shape of the thing** — a build pipeline producing static artifacts, and a viewer that consumes only those. Why: if the viewer can see nothing but build output, the pipeline can be rewritten without touching the renderer.
- **The package boundary** — `model` holds types, projection and the artifact contract; `pipeline` depends on it; `viewer` will depend on `model` and `dist/`, never on `pipeline`. Decision 0009, including the honest note that this is enforced by discipline rather than by tooling.
- **The canonical model** — entity identity plus validity intervals, not snapshots. Why intervals win (decision 0008), and why `prevId` / `delta` / `gap` are derived at build time (decision 0004).
- **The stages** — fetch, normalise, resolve identity, derive lineage, project, emit; then simplify and index in Milestone 2. One paragraph each, naming the file.
- **Determinism** — what it means here and why it is scoped to a pinned toolchain (ADR 0010).
- **Why no database** — at ~14,000 records a static build pipeline is genuinely sufficient. PostGIS becomes right in Phase 4, when there is authoring and more than one contributor. The canonical model is designed so that is an addition rather than a rewrite.

- [ ] **Step 3: Write `CONTRIBUTING.md`**

- **Setup** — `nvm use`, `pnpm install`, then `pnpm fetch` (about 100 MB, once). Tests run against the committed fixture and need no download.
- **Scripts** — `lint`, `format`, `typecheck`, `test`, `fetch`, `build`, `extract-fixture`, `fixture:bless`, with one line each.
- **Tests are the spec** — every acceptance criterion in a phase spec is a test named after the criterion. Adding a criterion means adding a test.
- **Determinism rules you must not break** — no wall-clock timestamps in `dist/`; all output through `writeArtifact`; explicit sorts; scaled-integer coordinates; validation failures throw rather than warn.
- **When to write a decision record** — anything that constrains future work or that someone will later ask "why on earth" about. `docs/decisions/`, numbered, roughly 15 lines: context, decision, consequences. Written when the decision is made.
- **Blessing fixtures** — what `pnpm fixture:bless` does and why an unreviewed re-bless defeats the regression net.
- **Deliberately deferred** — `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates, `CHANGELOG.md`. They arrive when there are contributors and releases to need them.

- [ ] **Step 4: Write the package READMEs**

`packages/model/README.md` — the canonical types, the Equal Earth projection and its inverse, the artifact file contract with the shape of each file, the coordinate scaling rule and why it is integers. State plainly: this package has no runtime dependencies and is the only thing the viewer may import.

`packages/pipeline/README.md` — the four commands with their flags (`fetch` with `--write-pins` / `--refresh` / `--sources`, `build` with `--sources` / `--out`, `extract-fixture`), what each reads and writes, how to bump an upstream source, and what to do when the build fails on a duplicate `from_year` or an unwhitelisted overlap.

- [ ] **Step 5: Verify and commit**

```bash
pnpm lint
git add README.md CONTRIBUTING.md docs/architecture.md packages/*/README.md
git commit -m "docs: project README, architecture guide and contributing guide"
```

---

### Task 18: CI, and retiring the Phase 0 spike

Closes Milestone 1. The spike has served its purpose — the projection maths is ported and the alpha curves are recorded in decisions 0001, 0004 and 0006 — so it goes, per `docs/phase-1-importer.md`.

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/full-build.yml`
- Delete: `scripts/`, `src/`, `index.html`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the `pnpm` scripts from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the fast CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
```

The Node version comes from `.nvmrc`, which is what makes the determinism test meaningful — see ADR 0010. Everything runs against the committed fixture, so CI needs no download.

- [ ] **Step 2: Write the manual full-build workflow**

`.github/workflows/full-build.yml`:

```yaml
name: Full build

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm fetch
      - run: pnpm build
      - name: Report artifact sizes against the 8 MB budget
        run: |
          node -e "
            const m = require('./dist/manifest.json');
            for (const a of m.artifacts) {
              console.log(a.file, a.bytes, 'bytes,', a.gzipBytes, 'gzipped');
            }
          "
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/
```

The 8 MB gzipped budget applies to the coarsest artifact, which Milestone 2 introduces. This job prints the numbers so the trend is visible before that.

- [ ] **Step 3: Verify CI passes before deleting anything**

```bash
git add .github
git commit -m "ci: fixture-based checks and a manual full-build workflow"
git push
gh run watch
```

Expected: the `check` job goes green. Do not proceed until it does.

- [ ] **Step 4: Retire the spike**

The projection maths now lives in `packages/model/src/projection.ts`. The alpha curves and flash attribution from `src/lib/temporal.mjs` are recorded in decisions 0001, 0004 and 0006, which is where Phase 2 will read them — the code itself is viewer logic that Phase 2 writes fresh.

```bash
git rm -r --quiet scripts src index.html
```

- [ ] **Step 5: Update CLAUDE.md's "Current state"**

Replace that section with the following, keeping the rest of the file untouched. It stays short deliberately — it loads every session, and a long one dilutes itself.

```markdown
## Current state

Phase 0 is closed. Findings: `docs/phase-0-findings.md`. The spike is deleted;
its conclusions live in `docs/decisions/`.

Phase 1 is the data spine: `docs/phase-1-importer.md` is the canonical spec,
`docs/phase-1-design.md` the implementation design.

Milestone 1 is complete — `pnpm fetch && pnpm build` produces validated `dist/`
artifacts at full detail, and every M1 acceptance criterion is a named test.
Milestone 2 is next: topology-preserving simplification at the two coarser
levels, and the spatially-bucketed change-year index.

Start at `docs/architecture.md`.
```

- [ ] **Step 6: Final verification and commit**

```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build
git add -A
git commit -m "chore: retire the Phase 0 spike, close Milestone 1"
git push
```

Expected: everything green, `dist/` regenerated, CI green on the pushed commit.

---

## Definition of done

Milestone 1 is complete when all of these hold:

- `pnpm fetch && pnpm build` produces `dist/` with `polities.json`, `versions.2.json`, `land.0.json`, `land.1.json` and `manifest.json`.
- `pnpm test` is green, and every Milestone 1 acceptance criterion in `docs/phase-1-importer.md` maps to a test named after it.
- `pnpm lint` and `pnpm typecheck` are clean; CI is green on `main`.
- `manifest.json` names all three sources with real upstream versions, licences and checksums, and contains no wall-clock time.
- Two consecutive builds of the fixture are byte-identical.
- `scripts/`, `src/` and `index.html` are gone; `README.md`, `docs/architecture.md` and `CONTRIBUTING.md` exist.
- Decision records 0010 and 0011 are written.

## Deferred to Milestone 2

Its plan is written once Milestone 1 has run against the real dataset, because the simplification percentages have to be tuned against measured artifact sizes rather than guessed.

- `pipeline simplify` — topology-preserving mapshaper simplification producing `versions.1.json` and `versions.0.json`.
- `changes.json` — the spatially-bucketed change-year index backing decision 0006's viewport-scoped `nextVisibleChange`.
- Acceptance criteria: no previously-adjacent polygons gain a gap wider than one screen pixel; 1,000 random `(year, bbox)` index lookups match a brute-force scan; the coarsest global artifact is under 8 MB gzipped.
