# Phase 2 Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed viewer that plays the whole world at coarse detail -- land basemap, crossfading territories, expansion flash, and an adaptive speed control -- so the two things Phase 0 left unvalidated can finally be judged.

**Architecture:** A DOM-free `engine/` turns a fractional year into a plain `Frame` (`{ year, speed, mode, draws }`); a `render/` layer draws that Frame onto a canvas from prebuilt `Path2D`; a `ui/` layer owns the chrome and talks only to the engine. The split exists so decisions 0001, 0004 and 0006 become named tests instead of things checked by eye.

**Tech Stack:** TypeScript (strict), Vite, canvas 2D, Vitest. No UI framework, no map library, no runtime dependencies beyond `@history/model`.

**Spec:** `docs/phase-2-milestone-1-design.md` -- read it first. It carries the measurements that justify nearly every constant and every design subtraction here.

## Global Constraints

- **Node 22** (`.nvmrc`), pnpm workspaces. Run `nvm use` before anything.
- **TypeScript strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` (inherited from `tsconfig.base.json`). `noUncheckedIndexedAccess` means every `array[i]` is `T | undefined` -- existing code handles this with an `as T` cast after a bounds-guaranteed access; follow that pattern.
- **Biome** with `--error-on-warnings`. 2-space indent, 100-column lines. Run `pnpm lint` before every commit.
- **Vitest**, `packages/*/tests/**/*.test.ts`, `environment: "node"`. Tests must not require a DOM. Nothing in `src/engine/` may import from `src/render/` or `src/ui/`, or touch `window`, `document` or `fetch`.
- **ASCII only** in TypeScript sources. The one existing exception is `packages/model/tests/normalize-name.test.ts`, which tests diacritic handling.
- **The viewer may import `@history/model`. It may never import `@history/pipeline`.** See `docs/architecture.md`.
- **Never invent geometry or dramatise what the data cannot support** (`docs/standards.md`). In this milestone that rule bites on fade direction and flash suppression specifically.
- Tests run against `fixtures/dist`, never `dist/`, so `pnpm test` needs no download.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`), and end every message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File structure

```
packages/viewer/
  package.json          workspace package, vite scripts
  tsconfig.json         extends base, adds DOM lib
  vite.config.ts        serves dist/ (or fixtures/dist/) as static data
  index.html
  src/
    main.ts             wiring only: load -> engine -> renderer -> chrome
    data/
      artifacts.ts      fetch, schemaVersion validation
    engine/
      constants.ts      every tunable in one place
      frame.ts          Frame and Draw types -- the engine/render contract
      fade.ts           fade width and alpha ramps (0001)
      flash.ts          expansion flash strength and envelope (0004)
      timeline.ts       year -> Draw[]
      change-years.ts   nextChangeAfter over derived event years
      clock.ts          adaptive speed, Auto/manual (0006)
      engine.ts         composes the above into a Frame
    render/
      transform.ts      projected units -> screen pixels
      palette.ts        polity id -> colour
      canvas.ts         draws a Frame
    ui/
      chrome.ts         controls, readout, attribution
  tests/
    artifacts.test.ts  fade.test.ts  flash.test.ts  timeline.test.ts
    change-years.test.ts  clock.test.ts  engine.test.ts  render.test.ts
```

---

### Task 1: Viewer package scaffold and artifact loading

**Files:**
- Create: `packages/viewer/package.json`, `packages/viewer/tsconfig.json`, `packages/viewer/vite.config.ts`, `packages/viewer/index.html`, `packages/viewer/src/main.ts`, `packages/viewer/src/data/artifacts.ts`
- Modify: `package.json` (root: `typecheck` and a `dev` script)
- Test: `packages/viewer/tests/artifacts.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, and the artifact types, from `@history/model`.
- Produces: `interface Artifacts { polities: PolitiesArtifact; versions: VersionsArtifact; land: LandArtifact }`, `assertSchema(file: string, schemaVersion: number): void`, `validateArtifacts(a: Artifacts): Artifacts`, `fetchArtifacts(base?: string): Promise<Artifacts>`.

Note there are **three** artifacts, not four. `changes.json` is deliberately not loaded -- see Task 5 and the spec's `change-years.ts` section.

- [ ] **Step 1: Create the package**

`packages/viewer/package.json`:

```json
{
  "name": "@history/viewer",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@history/model": "workspace:*"
  }
}
```

Then add Vite and pin the exact resolved version (the repo pins exact versions for tooling -- see `biome`, `typescript`, `vitest` in the root `package.json`):

```bash
nvm use
pnpm --filter @history/viewer add -D vite
```

Open `packages/viewer/package.json` afterwards and replace the `^x.y.z` Vite version with the exact resolved version, then re-run `pnpm install`.

- [ ] **Step 2: Add tsconfig and Vite config**

`packages/viewer/tsconfig.json` -- the base config's `lib` is `["ES2023"]` with no DOM, so it must be widened here:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vite.config.ts"]
}
```

`packages/viewer/vite.config.ts`. Serving the build output as Vite's `publicDir` puts the artifacts at the site root with no copy step, and falling back to `fixtures/dist` means a fresh clone runs without the 46 MB source download:

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const repoRoot = resolve(import.meta.dirname, "../..");
const full = resolve(repoRoot, "dist");
const fixture = resolve(repoRoot, "fixtures/dist");

/**
 * Artifacts are served as static files at the site root. dist/ is gitignored
 * and only exists after `pnpm build`, so a fresh clone falls back to the
 * committed fixture slice rather than failing to start.
 */
const dataDir = existsSync(full) ? full : fixture;

export default defineConfig({
  publicDir: dataDir,
  build: { outDir: "dist-app", emptyOutDir: true },
});
```

`packages/viewer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>History map</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

Add `packages/viewer/dist-app/` to `.gitignore`.

- [ ] **Step 3: Wire the root scripts**

In the root `package.json`, extend `typecheck` and add `dev`:

```json
"typecheck": "tsc -p packages/model && tsc -p packages/pipeline && tsc -p packages/viewer",
"dev": "pnpm --filter @history/viewer dev",
```

- [ ] **Step 4: Write the failing test**

`packages/viewer/tests/artifacts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { LandArtifact, PolitiesArtifact, VersionsArtifact } from "@history/model";
import { validateArtifacts } from "../src/data/artifacts";

const FIXTURES = "fixtures/dist";

function load() {
  return {
    polities: readArtifact<PolitiesArtifact>(`${FIXTURES}/polities.json`),
    versions: readArtifact<VersionsArtifact>(`${FIXTURES}/versions.0.json`),
    land: readArtifact<LandArtifact>(`${FIXTURES}/land.0.json`),
  };
}

describe("validateArtifacts", () => {
  it("accepts the committed fixture artifacts", () => {
    expect(() => validateArtifacts(load())).not.toThrow();
  });

  // Acceptance criterion 18: the viewer refuses to start on an unrecognised
  // schemaVersion rather than half-rendering a map built from assumptions
  // that no longer hold.
  it("refuses an unrecognised schemaVersion, naming the file", () => {
    const a = load();
    a.versions.schemaVersion = 999;
    expect(() => validateArtifacts(a)).toThrow(/versions\.0\.json.*999/);
  });

  it("checks every artifact, not just the first", () => {
    const a = load();
    a.land.schemaVersion = 999;
    expect(() => validateArtifacts(a)).toThrow(/land\.0\.json/);
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/artifacts.test.ts`
Expected: FAIL -- cannot resolve `../src/data/artifacts`.

- [ ] **Step 6: Implement**

`packages/viewer/src/data/artifacts.ts`:

```ts
import type { LandArtifact, PolitiesArtifact, VersionsArtifact } from "@history/model";
import { SCHEMA_VERSION } from "@history/model";

/**
 * The three artifacts M1 needs. `changes.json` is deliberately absent: its
 * cells mix fromYear and toYear values indistinguishably, so the event years
 * playback needs cannot be recovered from it. See src/engine/change-years.ts.
 */
export interface Artifacts {
  polities: PolitiesArtifact;
  versions: VersionsArtifact;
  land: LandArtifact;
}

export function assertSchema(file: string, schemaVersion: number): void {
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${file}: unsupported schemaVersion ${schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
}

export function validateArtifacts(a: Artifacts): Artifacts {
  assertSchema("polities.json", a.polities.schemaVersion);
  assertSchema("versions.0.json", a.versions.schemaVersion);
  assertSchema("land.0.json", a.land.schemaVersion);
  return a;
}

/**
 * `base` is relative by default so the app works when served from a subpath
 * such as https://<user>.github.io/mankind-history/. A leading slash would
 * resolve against the domain root and 404 there.
 */
export async function fetchArtifacts(base = "."): Promise<Artifacts> {
  const get = async <T>(name: string): Promise<T> => {
    const res = await fetch(`${base}/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };
  const [polities, versions, land] = await Promise.all([
    get<PolitiesArtifact>("polities.json"),
    get<VersionsArtifact>("versions.0.json"),
    get<LandArtifact>("land.0.json"),
  ]);
  return validateArtifacts({ polities, versions, land });
}
```

`packages/viewer/src/main.ts` -- a placeholder that proves the app boots and the data loads. Later tasks replace its body:

```ts
import { fetchArtifacts } from "./data/artifacts";

async function start(): Promise<void> {
  const app = document.querySelector("#app");
  if (!app) throw new Error("#app is missing from index.html");
  app.textContent = "Loading...";
  const artifacts = await fetchArtifacts();
  app.textContent = `${artifacts.polities.polities.length} polities, ${artifacts.versions.rows.length} versions`;
}

void start();
```

- [ ] **Step 7: Verify**

```bash
pnpm vitest run packages/viewer/tests/artifacts.test.ts   # PASS
pnpm lint && pnpm typecheck
pnpm dev    # visit the printed URL; it should report the polity and version counts
```

- [ ] **Step 8: Commit**

```bash
git add packages/viewer package.json pnpm-lock.yaml .gitignore
git commit -m "feat(viewer): scaffold the package and artifact loading

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fade width and alpha ramps

**Files:**
- Create: `packages/viewer/src/engine/constants.ts`, `packages/viewer/src/engine/fade.ts`
- Test: `packages/viewer/tests/fade.test.ts`

**Interfaces:**
- Produces: `fadeYearsFor(fromYear: number, toYear: number, speed: number): number`, `alphaFor(year: number, fromYear: number, toYear: number, fadeYears: number): number`, and the constants `BASE_SPEED`, `FADE_SECONDS`, `APPROACH_SECONDS`, `TAU`, `SPEED_STEPS`.

This is where decision 0006's broken clamp is replaced. Read the spec's "Decision 0006's fade formula does not survive the real data" section before starting.

- [ ] **Step 1: Write the constants**

`packages/viewer/src/engine/constants.ts`:

```ts
/**
 * Every playback tunable, in one place. All provisional until the Milestone 1
 * feel session -- see docs/phase-2-milestone-1-design.md.
 */

/** Years per second at reading speed. Phase 0 settled on 4. */
export const BASE_SPEED = 4;

/** Wall-clock fade duration. Constant across speeds, per decision 0006. */
export const FADE_SECONDS = 0.4;

/**
 * Auto mode aims to cover the distance to the next change in this many
 * seconds, floored at BASE_SPEED. Dead time grows only logarithmically in gap
 * size: this dataset's largest gap, 300 years, closes in 7.58 s.
 */
export const APPROACH_SECONDS = 1.5;

/** Smoothing time constant for acceleration only. Deceleration is immediate. */
export const TAU = 0.3;

/** Selectable speeds, in years per second. Auto is a separate mode. */
export const SPEED_STEPS = [1, 2, 4, 8, 16] as const;
```

- [ ] **Step 2: Write the failing test**

`packages/viewer/tests/fade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { VersionsArtifact } from "@history/model";
import { BASE_SPEED } from "../src/engine/constants";
import { alphaFor, fadeYearsFor } from "../src/engine/fade";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;
const SPEEDS = [1, 2, 4, 8, 16, 64];

describe("fadeYearsFor", () => {
  // Acceptance criterion 6. Decision 0006's own formula clamps to
  // medianVersionDuration / 6 = 1.17 with a lower bound of 1.5 -- inverted
  // bounds, ill-defined. The cap is on EXTENT (toYear - fromYear + 1), not
  // duration: 8.9% of real versions have toYear === fromYear, and a
  // duration-based cap would give those a fade of zero, i.e. a hard cut on a
  // tenth of the dataset, which is what 0001 exists to prevent.
  it("never exceeds half a version's own extent, at any speed", () => {
    for (const r of rows) {
      const extent = r.toYear - r.fromYear + 1;
      for (const speed of SPEEDS) {
        expect(fadeYearsFor(r.fromYear, r.toYear, speed)).toBeLessThanOrEqual(extent / 2);
      }
    }
  });

  it("gives a single-year version a positive fade rather than a hard cut", () => {
    const single = rows.filter((r) => r.toYear === r.fromYear);
    expect(single.length).toBeGreaterThan(0);
    for (const r of single) {
      expect(fadeYearsFor(r.fromYear, r.toYear, BASE_SPEED)).toBeCloseTo(0.5, 10);
    }
  });
});

describe("alphaFor", () => {
  // Acceptance criterion 7. Decision 0001: the polity genuinely existed up to
  // toYear, so no dissolve may begin before toYear + 1. The same argument
  // forbids ramping up before fromYear.
  it("never dissolves before the claim ends, and never appears before it begins", () => {
    for (const r of rows) {
      const fade = fadeYearsFor(r.fromYear, r.toYear, BASE_SPEED);
      const end = r.toYear + 1;
      expect(alphaFor(r.fromYear - 1e-9, r.fromYear, r.toYear, fade)).toBe(0);
      let prev = -1;
      for (let y = r.fromYear; y <= end; y += (end - r.fromYear) / 64 || 1) {
        const a = alphaFor(y, r.fromYear, r.toYear, fade);
        expect(a).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = a;
      }
    }
  });

  // Acceptance criterion 8.
  it("is 0 outside the window, exactly 1 through the hold, monotonic on each ramp", () => {
    const fade = fadeYearsFor(100, 120, BASE_SPEED);
    expect(fade).toBeCloseTo(1.6, 10);
    expect(alphaFor(99, 100, 120, fade)).toBe(0);
    expect(alphaFor(100, 100, 120, fade)).toBe(0);
    expect(alphaFor(100.8, 100, 120, fade)).toBeCloseTo(0.5, 10);
    expect(alphaFor(101.6, 100, 120, fade)).toBe(1);
    expect(alphaFor(110, 100, 120, fade)).toBe(1);
    expect(alphaFor(121, 100, 120, fade)).toBe(1);
    expect(alphaFor(121.8, 100, 120, fade)).toBeCloseTo(0.5, 10);
    expect(alphaFor(122.6, 100, 120, fade)).toBe(0);
    expect(alphaFor(200, 100, 120, fade)).toBe(0);
  });

  it("holds at 1 when the fade width is zero", () => {
    expect(alphaFor(100, 100, 120, 0)).toBe(1);
    expect(alphaFor(121, 100, 120, 0)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/fade.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/fade`.

- [ ] **Step 4: Implement**

`packages/viewer/src/engine/fade.ts`:

```ts
import { FADE_SECONDS } from "./constants";

/**
 * Fade width in years, per version. Amends decision 0006, whose
 * `clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)` is ill-defined
 * against the real data: the measured median duration of 7 years puts the
 * upper bound at 1.17, below the lower bound of 1.5.
 *
 * The cap is on extent -- the years the version actually occupies -- and not
 * on `toYear - fromYear`. 1,190 versions (8.9%) have `toYear === fromYear`, so
 * a duration-based cap would fade them over zero years: a hard cut on a tenth
 * of the dataset, which is precisely what decision 0001 exists to avoid.
 */
export function fadeYearsFor(fromYear: number, toYear: number, speed: number): number {
  const extent = toYear - fromYear + 1;
  return Math.min(FADE_SECONDS * speed, extent / 2);
}

/**
 * Opacity at a fractional year. Ramps up over [fromYear, fromYear + fade],
 * holds at 1 until toYear + 1, then dissolves over the following `fade` years.
 *
 * Both fades sit inside or after the claim, never before it. Decision 0001
 * requires the dissolve to follow toYear, because the polity genuinely existed
 * up to it; the same argument forbids ramping up ahead of fromYear. The
 * crossfade still works, because a successor's fromYear is its predecessor's
 * toYear + 1, so the fade-in overlaps the fade-out exactly -- but only the
 * predecessor is ever shown outside its own claim.
 */
export function alphaFor(
  year: number,
  fromYear: number,
  toYear: number,
  fadeYears: number,
): number {
  const end = toYear + 1;
  if (year < fromYear || year >= end + fadeYears) return 0;
  if (fadeYears <= 0) return 1;
  if (year < fromYear + fadeYears) return (year - fromYear) / fadeYears;
  if (year <= end) return 1;
  return 1 - (year - end) / fadeYears;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run packages/viewer/tests/fade.test.ts` -- PASS.
Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/engine packages/viewer/tests/fade.test.ts
git commit -m "feat(viewer): fade width and alpha ramps

Amends decision 0006's fade formula, whose clamp bounds are inverted against
the real data, and caps on extent rather than duration so the 8.9% of versions
occupying a single year fade rather than cut.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The expansion flash

**Files:**
- Create: `packages/viewer/src/engine/flash.ts`
- Test: `packages/viewer/tests/flash.test.ts`

**Interfaces:**
- Consumes: `Version` from `@history/model`.
- Produces: `flashStrengthFor(v: Version): number`, `flashEnvelope(year: number, fromYear: number, fadeYears: number): number`, `FULL_FLASH_AT: number`.

Read `docs/decisions/0004-expansion-flash-attribution.md` first. Its opening line is a warning that "why doesn't this territory flash" has a deliberate answer.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/flash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { Version, VersionsArtifact } from "@history/model";
import { flashEnvelope, flashStrengthFor } from "../src/engine/flash";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;

function version(over: Partial<Version>): Version {
  return {
    id: "name:X@100",
    polityId: "name:X",
    fromYear: 100,
    toYear: 120,
    area: 150,
    prevId: "name:X@80",
    delta: 50,
    gap: 20,
    confidence: null,
    source: { dataset: "cliopatria", version: "test" },
    ...over,
  };
}

describe("flashStrengthFor", () => {
  // Acceptance criterion 9. Decision 0004: a first appearance is often the
  // atlas beginning to cover a region, not a polity coming into being.
  it("is silent on a first appearance", () => {
    expect(flashStrengthFor(version({ prevId: null, delta: null, gap: null }))).toBe(0);
    const real = rows.filter((r) => r.prevId === null);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);
  });

  // Acceptance criterion 10. A gap that long is not attributable to a datable
  // event -- it is centuries of drift between two atlas samples.
  it("is silent when the gap since the previous version exceeds 50 years", () => {
    expect(flashStrengthFor(version({ gap: 51 }))).toBe(0);
    expect(flashStrengthFor(version({ gap: 50 }))).toBeGreaterThan(0);
    const real = rows.filter((r) => (r.gap ?? 0) > 50);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);
  });

  // Acceptance criterion 11. Contraction fades without a flash.
  it("is silent on a zero or negative delta", () => {
    expect(flashStrengthFor(version({ delta: 0 }))).toBe(0);
    expect(flashStrengthFor(version({ delta: -20 }))).toBe(0);
    const real = rows.filter((r) => r.prevId !== null && (r.delta ?? 0) <= 0);
    expect(real.length).toBeGreaterThan(0);
    for (const r of real) expect(flashStrengthFor(r)).toBe(0);
  });

  // Acceptance criterion 12. Strength scales with RELATIVE change, so a small
  // polity doubling reads as strongly as an empire gaining a few percent.
  it("reaches full strength at +50% relative area and is monotonic below it", () => {
    // prevArea = area - delta. 100 -> 150 is +50%.
    expect(flashStrengthFor(version({ area: 150, delta: 50 }))).toBeCloseTo(1, 10);
    expect(flashStrengthFor(version({ area: 300, delta: 200 }))).toBe(1);
    expect(flashStrengthFor(version({ area: 125, delta: 25 }))).toBeCloseTo(0.5, 10);
    expect(flashStrengthFor(version({ area: 110, delta: 10 }))).toBeCloseTo(0.2, 10);

    const small = flashStrengthFor(version({ area: 2, delta: 1 }));   // 1 -> 2, +100%
    const large = flashStrengthFor(version({ area: 1_100_000, delta: 100_000 })); // +10%
    expect(small).toBe(1);
    expect(large).toBeCloseTo(0.2, 10);
  });

  it("is between 0 and 1 for every version in the fixture", () => {
    for (const r of rows) {
      const s = flashStrengthFor(r);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("flashEnvelope", () => {
  it("peaks as the version reaches full opacity and is gone afterwards", () => {
    expect(flashEnvelope(100, 100, 1.6)).toBe(0);
    expect(flashEnvelope(101.6, 100, 1.6)).toBeCloseTo(1, 10);
    expect(flashEnvelope(104.8, 100, 1.6)).toBeCloseTo(0, 10);
    expect(flashEnvelope(110, 100, 1.6)).toBe(0);
    expect(flashEnvelope(99, 100, 1.6)).toBe(0);
  });

  it("is silent when there is no fade to ride", () => {
    expect(flashEnvelope(100, 100, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/flash.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/flash`.

- [ ] **Step 3: Implement**

`packages/viewer/src/engine/flash.ts`:

```ts
import type { Version } from "@history/model";

/** Relative area growth at which the flash reaches full strength (0004). */
export const FULL_FLASH_AT = 0.5;

/** Gap in years beyond which growth is not attributable to an event (0004). */
export const MAX_ATTRIBUTABLE_GAP = 50;

/**
 * Decision 0004. Brightness reads as conquest, so it is suppressed wherever
 * the data cannot support that reading. The flash going quiet exactly where
 * coverage is weakest is the intended behaviour, not a bug.
 *
 * Strength scales with RELATIVE area change so a small polity doubling reads
 * as strongly as an empire gaining a few percent. `prevArea` is not stored on
 * Version; it is exactly `area - delta`, both being build-time values.
 */
export function flashStrengthFor(v: Version): number {
  if (v.prevId === null) return 0;
  if (v.gap !== null && v.gap > MAX_ATTRIBUTABLE_GAP) return 0;
  if (v.delta === null || v.delta <= 0) return 0;
  const prevArea = v.area - v.delta;
  if (prevArea <= 0) return 0;
  return Math.min(1, v.delta / prevArea / FULL_FLASH_AT);
}

/**
 * The flash is an event, not a tint: it rides the fade-in, peaks as the
 * version reaches full opacity, and decays away over twice the fade width.
 */
export function flashEnvelope(year: number, fromYear: number, fadeYears: number): number {
  if (fadeYears <= 0) return 0;
  const decay = fadeYears * 2;
  const t = year - fromYear;
  if (t < 0 || t >= fadeYears + decay) return 0;
  if (t < fadeYears) return t / fadeYears;
  return 1 - (t - fadeYears) / decay;
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run packages/viewer/tests/flash.test.ts` -- PASS. Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/engine/flash.ts packages/viewer/tests/flash.test.ts
git commit -m "feat(viewer): the expansion flash and its three suppression rules

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The timeline

**Files:**
- Create: `packages/viewer/src/engine/frame.ts`, `packages/viewer/src/engine/timeline.ts`
- Test: `packages/viewer/tests/timeline.test.ts`

**Interfaces:**
- Consumes: `fadeYearsFor`, `alphaFor` (Task 2); `flashStrengthFor`, `flashEnvelope` (Task 3).
- Produces: `type PlaybackMode = "auto" | "manual"`, `interface Draw { versionId: string; alpha: number; flash: number }`, `interface Frame { year: number; speed: number; mode: PlaybackMode; draws: Draw[] }`, and `class Timeline` with `constructor(artifact: VersionsArtifact)`, `readonly range: readonly [number, number]`, `activeAt(year: number, speed: number): Draw[]`.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { VersionsArtifact } from "@history/model";
import { BASE_SPEED } from "../src/engine/constants";
import { Timeline } from "../src/engine/timeline";

const artifact = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
const timeline = new Timeline(artifact);

describe("Timeline", () => {
  it("reports the range spanned by its rows", () => {
    const lo = Math.min(...artifact.rows.map((r) => r.fromYear));
    const hi = Math.max(...artifact.rows.map((r) => r.toYear));
    expect(timeline.range).toEqual([lo, hi]);
  });

  // Acceptance criterion 13. The oracle is the RAW CLAIM INTERVAL, which the
  // fade logic never consults -- deliberately not a brute-force rescan, which
  // would be vacuous here because the implementation is itself a linear scan.
  // Milestone 2 of Phase 1 shipped a vacuous test of exactly that shape.
  //
  // Note the half-open interval: at y === fromYear a version is at the very
  // start of its fade-in and so at alpha 0, which is correct.
  it("returns every version whose claim contains the year, at positive alpha", () => {
    for (const r of artifact.rows) {
      for (const y of [r.fromYear + 1e-6, (r.fromYear + r.toYear + 1) / 2, r.toYear + 1]) {
        const hit = timeline.activeAt(y, BASE_SPEED).find((d) => d.versionId === r.id);
        expect(hit, `${r.id} missing at year ${y}`).toBeDefined();
        expect((hit as { alpha: number }).alpha).toBeGreaterThan(0);
      }
    }
  });

  it("never returns an alpha outside (0, 1]", () => {
    const [lo, hi] = timeline.range;
    for (let y = lo; y <= hi + 2; y += 7.5) {
      for (const d of timeline.activeAt(y, BASE_SPEED)) {
        expect(d.alpha).toBeGreaterThan(0);
        expect(d.alpha).toBeLessThanOrEqual(1);
        expect(d.flash).toBeGreaterThanOrEqual(0);
        expect(d.flash).toBeLessThanOrEqual(1);
      }
    }
  });

  it("returns nothing before the first claim or long after the last", () => {
    const [lo, hi] = timeline.range;
    expect(timeline.activeAt(lo - 1, BASE_SPEED)).toHaveLength(0);
    expect(timeline.activeAt(hi + 100, BASE_SPEED)).toHaveLength(0);
  });

  it("suppresses the flash wherever flashStrengthFor does", () => {
    const suppressed = new Set(
      artifact.rows.filter((r) => r.prevId === null || (r.gap ?? 0) > 50).map((r) => r.id),
    );
    const [lo, hi] = timeline.range;
    for (let y = lo; y <= hi; y += 11.5) {
      for (const d of timeline.activeAt(y, BASE_SPEED)) {
        if (suppressed.has(d.versionId)) expect(d.flash).toBe(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/timeline.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/timeline`.

- [ ] **Step 3: Implement**

`packages/viewer/src/engine/frame.ts`:

```ts
/** Whether playback adapts to the data or honours a speed the user set. */
export type PlaybackMode = "auto" | "manual";

/** One version to draw this frame. */
export interface Draw {
  versionId: string;
  /** Opacity, in (0, 1]. */
  alpha: number;
  /** Expansion-flash brightness, in [0, 1]. Zero for most versions. */
  flash: number;
}

/**
 * The entire engine-to-renderer contract. Plain data, so the engine's
 * behaviour can be snapshot-tested without a canvas.
 */
export interface Frame {
  year: number;
  speed: number;
  mode: PlaybackMode;
  draws: Draw[];
}
```

`packages/viewer/src/engine/timeline.ts`:

```ts
import type { Version, VersionsArtifact } from "@history/model";
import { alphaFor, fadeYearsFor } from "./fade";
import { flashEnvelope, flashStrengthFor } from "./flash";
import type { Draw } from "./frame";

/**
 * Turns a fractional year into the set of versions to draw.
 *
 * A linear scan over every row, every frame. Measured: the worst year in the
 * real dataset has 195 active versions and under 20,000 vertices on screen, so
 * 13,380 comparisons per frame is not worth indexing away -- and the scan
 * behaves identically under playback, scrubbing and jumping, with no cursor to
 * invalidate. See docs/phase-2-milestone-1-design.md.
 */
export class Timeline {
  private readonly rows: readonly Version[];
  /** Parallel to `rows`. Constant per version, so hoisted out of the frame loop. */
  private readonly strength: readonly number[];
  readonly range: readonly [number, number];

  constructor(artifact: VersionsArtifact) {
    this.rows = artifact.rows;
    this.strength = artifact.rows.map(flashStrengthFor);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const r of artifact.rows) {
      if (r.fromYear < lo) lo = r.fromYear;
      if (r.toYear > hi) hi = r.toYear;
    }
    this.range = [lo, hi];
  }

  activeAt(year: number, speed: number): Draw[] {
    const draws: Draw[] = [];
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i] as Version;
      const fade = fadeYearsFor(r.fromYear, r.toYear, speed);
      const alpha = alphaFor(year, r.fromYear, r.toYear, fade);
      if (alpha <= 0) continue;
      const s = this.strength[i] as number;
      draws.push({
        versionId: r.id,
        alpha,
        flash: s > 0 ? s * flashEnvelope(year, r.fromYear, fade) : 0,
      });
    }
    return draws;
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run packages/viewer/tests/timeline.test.ts` -- PASS. Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/engine packages/viewer/tests/timeline.test.ts
git commit -m "feat(viewer): the timeline, turning a year into a draw list

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Event years and nextChangeAfter

**Files:**
- Create: `packages/viewer/src/engine/change-years.ts`
- Test: `packages/viewer/tests/change-years.test.ts`

**Interfaces:**
- Produces: `eventYearsFrom(rows: readonly Version[]): number[]`, `class ChangeYears` with `constructor(rows: readonly Version[])`, `nextChangeAfter(year: number): number | null`, `readonly years: readonly number[]`.

Read the spec's `change-years.ts` section. The short version: `changes.json` is not used, because it stores `toYear` where the visible event is at `toYear + 1`, and its cells mix `fromYear` and `toYear` values indistinguishably. That is a real defect for M2 to fix in the pipeline, and it is already recorded.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/change-years.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { VersionsArtifact } from "@history/model";
import { ChangeYears, eventYearsFrom } from "../src/engine/change-years";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;

describe("eventYearsFrom", () => {
  // Acceptance criterion 15. The oracle is built here, independently of the
  // implementation: a fade-in begins at fromYear, a fade-out at toYear + 1.
  it("is exactly the union of fromYear and toYear + 1, sorted and unique", () => {
    const expected = [...new Set(rows.flatMap((r) => [r.fromYear, r.toYear + 1]))].sort(
      (a, b) => a - b,
    );
    expect(eventYearsFrom(rows)).toEqual(expected);
  });
});

describe("ChangeYears", () => {
  const changes = new ChangeYears(rows);

  it("returns the smallest event year strictly greater than the query", () => {
    for (const y of changes.years) {
      const next = changes.nextChangeAfter(y);
      if (next === null) continue;
      expect(next).toBeGreaterThan(y);
      const between = changes.years.filter((c) => c > y && c < next);
      expect(between).toHaveLength(0);
    }
  });

  it("handles fractional years", () => {
    const first = changes.years[0] as number;
    const second = changes.years[1] as number;
    expect(changes.nextChangeAfter(first + 0.5)).toBe(second);
    expect(changes.nextChangeAfter(first - 0.5)).toBe(first);
  });

  it("returns null past the last event", () => {
    const last = changes.years[changes.years.length - 1] as number;
    expect(changes.nextChangeAfter(last)).toBeNull();
    expect(changes.nextChangeAfter(last + 1000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/change-years.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/change-years`.

- [ ] **Step 3: Implement**

`packages/viewer/src/engine/change-years.ts`:

```ts
import type { Version } from "@history/model";

/**
 * The years at which something visibly changes: a version's fade-in begins at
 * its fromYear, and its fade-out begins at toYear + 1.
 *
 * Derived from the version rows, not from changes.json. The index cannot
 * answer this: its cells store fromYear and toYear values mixed together and
 * indistinguishable, so toYear + 1 is unrecoverable from them. The index
 * exists for viewport scoping, which Milestone 1 does not do -- with no zoom,
 * the whole world is the viewport. See docs/phase-2-milestone-1-design.md for
 * the pipeline fix Milestone 2 needs before it can use the index here.
 */
export function eventYearsFrom(rows: readonly Version[]): number[] {
  const years = new Set<number>();
  for (const r of rows) {
    years.add(r.fromYear);
    years.add(r.toYear + 1);
  }
  return [...years].sort((a, b) => a - b);
}

/** Backs decision 0006's "when does this view next change". */
export class ChangeYears {
  readonly years: readonly number[];

  constructor(rows: readonly Version[]) {
    this.years = eventYearsFrom(rows);
  }

  /** The smallest event year strictly greater than `year`, or null past the end. */
  nextChangeAfter(year: number): number | null {
    let lo = 0;
    let hi = this.years.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.years[mid] as number) > year) hi = mid;
      else lo = mid + 1;
    }
    return lo < this.years.length ? (this.years[lo] as number) : null;
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run packages/viewer/tests/change-years.test.ts` -- PASS. Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/engine/change-years.ts packages/viewer/tests/change-years.test.ts
git commit -m "feat(viewer): derive playback event years from version rows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The playback clock, and decision record 0014

**Files:**
- Create: `packages/viewer/src/engine/clock.ts`, `docs/decisions/0014-speed-control-auto-position.md`
- Modify: `docs/decisions/0006-adaptive-playback-speed.md` (status line pointing at 0014)
- Test: `packages/viewer/tests/clock.test.ts`

**Interfaces:**
- Consumes: `BASE_SPEED`, `APPROACH_SECONDS`, `TAU` (Task 2); `PlaybackMode` (Task 4).
- Produces: `class Clock` with `constructor(startYear: number)`, `year: number`, `readonly speed: number`, `mode: PlaybackMode`, `userSpeed: number`, `setAuto(): void`, `setUserSpeed(speed: number): void`, `tick(dt: number, nextChange: number | null): void`.

This is the heart of the milestone. Read the spec's `clock.ts` section, including the table showing why the earlier two-phase formulation was wrong by a factor of three.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/clock.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APPROACH_SECONDS, BASE_SPEED } from "../src/engine/constants";
import { Clock } from "../src/engine/clock";

const DT = 1 / 120;

/** Runs a clock across one gap and reports how long the crossing took. */
function crossGap(gap: number): { seconds: number; arrivalSpeed: number } {
  const clock = new Clock(0);
  const target = gap;
  let t = 0;
  while (clock.year < target && t < 300) {
    clock.tick(DT, target);
    t += DT;
  }
  return { seconds: t, arrivalSpeed: clock.speed };
}

describe("Clock in manual mode", () => {
  // Acceptance criterion 1. This is the amendment to decision 0006, which made
  // the user's setting a floor the system was free to exceed. A regression
  // here is silent, which is why it is asserted at every tick.
  it("honours the set speed exactly and never exceeds it", () => {
    for (const speed of [1, 2, 4, 8, 16]) {
      const clock = new Clock(0);
      clock.setUserSpeed(speed);
      expect(clock.mode).toBe("manual");
      for (let i = 0; i < 2000; i++) {
        // A change 500 years away is exactly the situation Auto would sprint
        // through. Manual must not.
        clock.tick(DT, 500);
        expect(clock.speed).toBe(speed);
      }
      expect(clock.year).toBeCloseTo(speed * 2000 * DT, 6);
    }
  });
});

describe("Clock in auto mode", () => {
  it("defaults to auto at reading speed", () => {
    const clock = new Clock(0);
    expect(clock.mode).toBe("auto");
    clock.tick(DT, 1);
    expect(clock.speed).toBe(BASE_SPEED);
  });

  // Acceptance criterion 2.
  it("never drops below reading speed", () => {
    const clock = new Clock(0);
    for (let i = 0; i < 5000; i++) {
      clock.tick(DT, clock.year + ((i % 400) + 1));
      expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    }
  });

  // Acceptance criterion 3. True by construction: the target equals BASE_SPEED
  // for the last BASE_SPEED * APPROACH_SECONDS years, and deceleration is
  // applied immediately rather than smoothed.
  it("arrives at exactly reading speed, from any gap", () => {
    for (const gap of [5, 14, 50, 100, 300]) {
      expect(crossGap(gap).arrivalSpeed).toBe(BASE_SPEED);
    }
  });

  // Acceptance criterion 4. The simulation is the oracle; the closed form is
  // not what the implementation computes.
  it("closes a gap within the logarithmic dead-time bound", () => {
    for (const gap of [5, 14, 50, 100, 300]) {
      const floor = BASE_SPEED * APPROACH_SECONDS;
      const bound =
        gap <= floor
          ? gap / BASE_SPEED + 0.5
          : APPROACH_SECONDS * (1 + Math.log(gap / floor)) + 0.5;
      expect(crossGap(gap).seconds, `gap ${gap}`).toBeLessThanOrEqual(bound);
    }
  });

  it("closes the dataset's largest gap inside Phase 0's dead-time range", () => {
    const { seconds } = crossGap(300);
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(10);
  });

  // Acceptance criterion 5.
  it("never moves the year backwards", () => {
    const clock = new Clock(-3400);
    let prev = clock.year;
    for (let i = 0; i < 20000; i++) {
      clock.tick(DT, clock.year + ((i * 7) % 300) + 1);
      expect(clock.year).toBeGreaterThanOrEqual(prev);
      prev = clock.year;
    }
  });

  it("returns to auto after a manual setting", () => {
    const clock = new Clock(0);
    clock.setUserSpeed(1);
    expect(clock.mode).toBe("manual");
    clock.setAuto();
    expect(clock.mode).toBe("auto");
    // Criterion 2 must hold from the very first tick after the switch, not
    // once smoothing has caught up from the slower manual speed.
    expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    for (let i = 0; i < 400; i++) {
      clock.tick(DT, 500);
      expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    }
    expect(clock.speed).toBeGreaterThan(BASE_SPEED);
  });

  it("holds reading speed when nothing is left to reach", () => {
    const clock = new Clock(0);
    for (let i = 0; i < 200; i++) clock.tick(DT, null);
    expect(clock.speed).toBe(BASE_SPEED);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/clock.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/clock`.

- [ ] **Step 3: Implement**

`packages/viewer/src/engine/clock.ts`:

```ts
import { APPROACH_SECONDS, BASE_SPEED, TAU } from "./constants";
import type { PlaybackMode } from "./frame";

/**
 * Playback speed, per decision 0006 as amended by 0014.
 *
 * Auto is the default and adapts: speed is set so the distance to the next
 * change would be covered in APPROACH_SECONDS, floored at reading speed. The
 * target therefore falls continuously as the event nears and equals BASE_SPEED
 * for the last BASE_SPEED * APPROACH_SECONDS years, which makes "arrive at
 * reading speed" true by construction rather than by tuning.
 *
 * Setting a numeric speed leaves Auto, and that speed is then honoured exactly
 * -- 0006 originally treated it as a floor the system could exceed. See 0014.
 */
export class Clock {
  year: number;
  mode: PlaybackMode = "auto";
  userSpeed = BASE_SPEED;
  private applied = BASE_SPEED;

  constructor(startYear: number) {
    this.year = startYear;
  }

  get speed(): number {
    return this.applied;
  }

  setAuto(): void {
    this.mode = "auto";
    // Returning from a manual speed below reading speed would otherwise leave
    // `applied` under BASE_SPEED until smoothing caught up, transiently
    // breaking the "auto never drags below reading speed" invariant.
    if (this.applied < BASE_SPEED) this.applied = BASE_SPEED;
  }

  setUserSpeed(speed: number): void {
    this.mode = "manual";
    this.userSpeed = speed;
    this.applied = speed;
  }

  tick(dt: number, nextChange: number | null): void {
    const target = this.targetSpeed(nextChange);
    if (this.mode === "manual" || target <= this.applied) {
      // Deceleration is immediate. That is not a jolt: in auto the target
      // falls continuously as the event nears, so `applied` simply tracks it.
      this.applied = target;
    } else {
      // Acceleration is smoothed, because the target does jump upward the
      // instant a change year is passed.
      this.applied += (target - this.applied) * (1 - Math.exp(-dt / TAU));
    }
    this.year += this.applied * dt;
  }

  private targetSpeed(nextChange: number | null): number {
    if (this.mode === "manual") return this.userSpeed;
    if (nextChange === null) return BASE_SPEED;
    const remaining = nextChange - this.year;
    if (remaining <= 0) return BASE_SPEED;
    return Math.max(BASE_SPEED, remaining / APPROACH_SECONDS);
  }
}
```

- [ ] **Step 4: Verify**

Run: `pnpm vitest run packages/viewer/tests/clock.test.ts` -- PASS. Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 5: Write decision record 0014**

`docs/decisions/0014-speed-control-auto-position.md`. Follow the house format: context, decision, consequences, roughly 15-40 lines. It must carry **both** amendments and the measurements that forced them, because a future reader will otherwise reasonably restore what 0006 says.

Content it must contain:

- **Context.** 0006 made the slider a floor: "The system only ever accelerates through emptiness, never drags below what was asked for." The project owner's position is that a speed the user explicitly set should be honoured exactly -- accelerating past it is not fair. Separately, 0006's fade formula does not survive the real data.
- **Decision, part 1.** The control has an **Auto position**, the default, where 0006's adaptive behaviour applies in full. Selecting any numeric speed leaves Auto, and that speed is then never exceeded. 0006's "speed is the only control" stays literally true: one control, with an auto detent.
- **Decision, part 2.** `fadeYears = min(FADE_SECONDS * speed, extent / 2)` where `extent = toYear - fromYear + 1`. 0006's `clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)` is ill-defined: the measured median duration of 7 years puts the upper bound at 1.17, below the lower bound of 1.5. The cap is on extent because 1,190 versions (8.9%) have `toYear === fromYear`; a duration-based cap fades those over zero years, a hard cut on a tenth of the dataset.
- **Decision, part 3.** The approach profile: `speed = max(BASE_SPEED, remaining / APPROACH_SECONDS)`. Record that the two-phase alternative (a fast stretch sized to finish in `D - DECEL_SECONDS`, then a fixed deceleration window) was simulated and takes 20.72 s on this dataset's 300-year maximum gap against a ceiling of 7, because it recomputes a fixed-time target every frame as the distance shrinks. This design closes the same gap in 7.58 s and arrives at reading speed exactly.
- **Consequences.** `D` stops being a constant that is set and becomes a property that falls out: dead time is `APPROACH_SECONDS * (1 + ln(G / (BASE_SPEED * APPROACH_SECONDS)))`, logarithmic in gap size, so `APPROACH_SECONDS` is a far less twitchy dial. Auto is the default, so most users see 0006's behaviour unchanged. All constants remain provisional until the Milestone 1 feel session.

Then add a line under 0006's **Status** pointing forward: `Amended by 0014 (Auto position replaces floor semantics; fade formula corrected).`

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/engine/clock.ts packages/viewer/tests/clock.test.ts docs/decisions
git commit -m "feat(viewer): adaptive playback clock, and decision 0014

Amends 0006. The speed control gains an Auto position: adaptive by default,
but a speed the user sets is honoured exactly rather than treated as a floor.
Records the fade correction and the approach profile, with the simulation
showing the two-phase alternative overruns the dead-time ceiling threefold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The engine, and frame snapshots

**Files:**
- Create: `packages/viewer/src/engine/engine.ts`
- Test: `packages/viewer/tests/engine.test.ts`

**Interfaces:**
- Consumes: `Timeline` (Task 4), `ChangeYears` (Task 5), `Clock` (Task 6), `Frame` (Task 4).
- Produces: `class Engine` with `constructor(artifact: VersionsArtifact)`, `readonly clock: Clock`, `readonly range: readonly [number, number]`, `playing: boolean`, `advance(dt: number): Frame`, `seek(year: number): Frame`, `frame(): Frame`.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { VersionsArtifact } from "@history/model";
import { Engine } from "../src/engine/engine";

const artifact = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("Engine", () => {
  it("starts paused at the beginning of the range", () => {
    const engine = new Engine(artifact);
    expect(engine.playing).toBe(false);
    expect(engine.clock.year).toBe(engine.range[0]);
  });

  it("does not advance the year while paused", () => {
    const engine = new Engine(artifact);
    const before = engine.clock.year;
    for (let i = 0; i < 100; i++) engine.advance(1 / 60);
    expect(engine.clock.year).toBe(before);
  });

  it("advances while playing and stops at the end of the range", () => {
    const engine = new Engine(artifact);
    engine.playing = true;
    for (let i = 0; i < 200000; i++) engine.advance(1 / 60);
    expect(engine.clock.year).toBeLessThanOrEqual(engine.range[1] + 1);
    expect(engine.playing).toBe(false);
  });

  it("seeks to an exact year and reports the frame there", () => {
    const engine = new Engine(artifact);
    const frame = engine.seek(0);
    expect(frame.year).toBe(0);
    expect(frame.draws.length).toBeGreaterThan(0);
  });

  // Acceptance criterion 19. The engine is DOM-free, so its whole behaviour is
  // snapshot-testable without a canvas. Snapshots are committed; a diff here
  // means playback changed, which is sometimes intended and never silent.
  it("produces stable frames at fixed years", () => {
    const engine = new Engine(artifact);
    for (const year of [-500, 0, 500, 1000, 1500, 2000]) {
      const frame = engine.seek(year);
      const summary = {
        year: frame.year,
        speed: frame.speed,
        mode: frame.mode,
        count: frame.draws.length,
        draws: frame.draws
          .map((d) => `${d.versionId} a=${d.alpha.toFixed(4)} f=${d.flash.toFixed(4)}`)
          .sort(),
      };
      expect(summary).toMatchSnapshot(`year ${year}`);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/engine.test.ts`
Expected: FAIL -- cannot resolve `../src/engine/engine`.

- [ ] **Step 3: Implement**

`packages/viewer/src/engine/engine.ts`:

```ts
import type { VersionsArtifact } from "@history/model";
import { ChangeYears } from "./change-years";
import { Clock } from "./clock";
import type { Frame } from "./frame";
import { Timeline } from "./timeline";

/**
 * Composes the timeline, the change years and the clock into a Frame. The
 * whole of what the renderer sees.
 */
export class Engine {
  readonly clock: Clock;
  readonly range: readonly [number, number];
  playing = false;
  private readonly timeline: Timeline;
  private readonly changes: ChangeYears;

  constructor(artifact: VersionsArtifact) {
    this.timeline = new Timeline(artifact);
    this.changes = new ChangeYears(artifact.rows);
    this.range = this.timeline.range;
    this.clock = new Clock(this.range[0]);
  }

  advance(dt: number): Frame {
    if (this.playing) {
      this.clock.tick(dt, this.changes.nextChangeAfter(this.clock.year));
      if (this.clock.year >= this.range[1] + 1) {
        this.clock.year = this.range[1] + 1;
        this.playing = false;
      }
    }
    return this.frame();
  }

  seek(year: number): Frame {
    this.clock.year = Math.min(Math.max(year, this.range[0]), this.range[1] + 1);
    return this.frame();
  }

  frame(): Frame {
    return {
      year: this.clock.year,
      speed: this.clock.speed,
      mode: this.clock.mode,
      draws: this.timeline.activeAt(this.clock.year, this.clock.speed),
    };
  }
}
```

- [ ] **Step 4: Verify and review the snapshot**

```bash
pnpm vitest run packages/viewer/tests/engine.test.ts
```

The first run writes `packages/viewer/tests/__snapshots__/engine.test.ts.snap`. **Open it and read it before committing.** Sanity-check that alphas are in (0, 1], that most flashes are 0, and that the version counts are plausible for a 47-version fixture. A snapshot committed without being read is not a regression net.

Then `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src/engine/engine.ts packages/viewer/tests/engine.test.ts \
        packages/viewer/tests/__snapshots__
git commit -m "feat(viewer): compose the engine, with committed frame snapshots

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Transform and palette

**Files:**
- Create: `packages/viewer/src/render/transform.ts`, `packages/viewer/src/render/palette.ts`
- Test: `packages/viewer/tests/render.test.ts`

**Interfaces:**
- Consumes: `WORLD_HALF_WIDTH`, `WORLD_HALF_HEIGHT`, `COORD_SCALE` from `@history/model`.
- Produces: `interface Viewport { width: number; height: number; scale: number; offsetX: number; offsetY: number }`, `fitWorld(width: number, height: number): Viewport`, `toScreen(v: Viewport, x: number, y: number, coordScale: number): [number, number]`, `fromScreen(v: Viewport, sx: number, sy: number, coordScale: number): [number, number]`, `colourFor(polityId: string): string`, `PALETTE_HUES: number`.

- [ ] **Step 1: Write the failing test**

`packages/viewer/tests/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readArtifact } from "@history/model/artifact";
import type { PolitiesArtifact, VersionsArtifact } from "@history/model";
import { COORD_SCALE, WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";
import { fitWorld, fromScreen, toScreen } from "../src/render/transform";
import { colourFor } from "../src/render/palette";

describe("transform", () => {
  const view = fitWorld(1400, 700);

  it("centres the projected world in the canvas", () => {
    const [cx, cy] = toScreen(view, 0, 0, COORD_SCALE.coarse);
    expect(cx).toBeCloseTo(700, 6);
    expect(cy).toBeCloseTo(350, 6);
  });

  it("fits the whole world inside the canvas", () => {
    const s = COORD_SCALE.coarse;
    const corners: Array<[number, number]> = [
      [-WORLD_HALF_WIDTH * s, -WORLD_HALF_HEIGHT * s],
      [WORLD_HALF_WIDTH * s, WORLD_HALF_HEIGHT * s],
    ];
    for (const [x, y] of corners) {
      const [sx, sy] = toScreen(view, x, y, s);
      expect(sx).toBeGreaterThanOrEqual(-1e-6);
      expect(sx).toBeLessThanOrEqual(1400 + 1e-6);
      expect(sy).toBeGreaterThanOrEqual(-1e-6);
      expect(sy).toBeLessThanOrEqual(700 + 1e-6);
    }
  });

  it("puts north at the top", () => {
    const s = COORD_SCALE.coarse;
    const [, north] = toScreen(view, 0, s, s);
    const [, south] = toScreen(view, 0, -s, s);
    expect(north).toBeLessThan(south);
  });

  // Acceptance criterion 16.
  it("round-trips a coordinate to within one pixel", () => {
    const s = COORD_SCALE.coarse;
    const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
    let checked = 0;
    for (const g of Object.values(versions.geometry)) {
      for (const poly of g.polygons) {
        for (const ring of poly) {
          for (let i = 0; i + 1 < ring.length; i += 2) {
            const x = ring[i] as number;
            const y = ring[i + 1] as number;
            const [sx, sy] = toScreen(view, x, y, s);
            const [bx, by] = fromScreen(view, sx, sy, s);
            const [rx, ry] = toScreen(view, bx, by, s);
            expect(Math.abs(rx - sx)).toBeLessThan(1);
            expect(Math.abs(ry - sy)).toBeLessThan(1);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe("palette", () => {
  // Acceptance criterion 17. Colour must be stable per polity: crossfading
  // between two versions of one polity while its colour shifts would read as
  // one entity being replaced by another -- exactly the false assertion
  // decision 0001 exists to avoid.
  it("gives a polity the same colour every time it is asked", () => {
    const polities = readArtifact<PolitiesArtifact>("fixtures/dist/polities.json").polities;
    for (const p of polities) {
      expect(colourFor(p.id)).toBe(colourFor(p.id));
    }
  });

  it("gives every version of one polity the same colour", () => {
    const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");
    const byPolity = new Map<string, Set<string>>();
    for (const r of versions.rows) {
      const seen = byPolity.get(r.polityId) ?? new Set<string>();
      seen.add(colourFor(r.polityId));
      byPolity.set(r.polityId, seen);
    }
    for (const [polityId, colours] of byPolity) {
      expect(colours.size, polityId).toBe(1);
    }
  });

  it("produces a valid colour string for every polity", () => {
    const polities = readArtifact<PolitiesArtifact>("fixtures/dist/polities.json").polities;
    for (const p of polities) {
      expect(colourFor(p.id)).toMatch(/^hsl\(\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%\)$/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/viewer/tests/render.test.ts`
Expected: FAIL -- cannot resolve `../src/render/transform`.

- [ ] **Step 3: Implement the transform**

`packages/viewer/src/render/transform.ts`:

```ts
import { WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";

/** A fitted view of the projected world. Milestone 1 has no pan or zoom. */
export interface Viewport {
  width: number;
  height: number;
  /** Screen pixels per projected unit. */
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fits the whole projected world into a canvas, preserving aspect and
 * centring. The projected world is 2 * WORLD_HALF_WIDTH units across.
 *
 * `scale` is the real pixels-per-projected-unit figure that canon.ts's
 * PX_PER_UNIT only guessed at. Milestone 2 replaces those constants with it.
 */
export function fitWorld(width: number, height: number): Viewport {
  const scale = Math.min(width / (WORLD_HALF_WIDTH * 2), height / (WORLD_HALF_HEIGHT * 2));
  return { width, height, scale, offsetX: width / 2, offsetY: height / 2 };
}

/** Scaled-integer projected coordinates to screen pixels. Y is flipped: north is up. */
export function toScreen(
  v: Viewport,
  x: number,
  y: number,
  coordScale: number,
): [number, number] {
  return [v.offsetX + (x / coordScale) * v.scale, v.offsetY - (y / coordScale) * v.scale];
}

/** The inverse of toScreen, in the same scaled-integer space. */
export function fromScreen(
  v: Viewport,
  sx: number,
  sy: number,
  coordScale: number,
): [number, number] {
  return [
    ((sx - v.offsetX) / v.scale) * coordScale,
    ((v.offsetY - sy) / v.scale) * coordScale,
  ];
}
```

- [ ] **Step 4: Implement the palette**

`packages/viewer/src/render/palette.ts`:

```ts
/**
 * Sixteen hues at low saturation on a dark plate, per Phase 0's visual
 * direction. The dark ground is what leaves lightness headroom above the base
 * tones for the expansion flash to travel into; on a light ground the flash
 * would have to invert to a saturation shift, which is far harder to notice
 * peripherally.
 *
 * Phase 0 explicitly did not validate this at real density and recorded the
 * fallback: if neighbours read as the same colour, use FEWER hues with more
 * lightness separation, not more hues. Judging that is part of Milestone 1.
 */
export const PALETTE_HUES = 16;
const SATURATION = 34;
/** Alternating lightness bands, so adjacent hues differ in two dimensions. */
const LIGHTNESS = [62, 52];

/** FNV-1a. Any stable hash works; this one is short and has no dependencies. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Colour is a property of the POLITY, not the version, and is stable for the
 * life of the id. Crossfading between two versions of one polity while its
 * colour shifts would read as one entity being replaced by another -- the
 * false assertion decision 0001 exists to avoid.
 */
export function colourFor(polityId: string): string {
  const h = hash(polityId);
  const hue = ((h % PALETTE_HUES) * 360) / PALETTE_HUES;
  const lightness = LIGHTNESS[Math.floor(h / PALETTE_HUES) % LIGHTNESS.length] as number;
  return `hsl(${hue} ${SATURATION}% ${lightness}%)`;
}
```

- [ ] **Step 5: Verify**

Run: `pnpm vitest run packages/viewer/tests/render.test.ts` -- PASS. Then `pnpm lint && pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/viewer/src/render packages/viewer/tests/render.test.ts
git commit -m "feat(viewer): world-to-screen transform and the stable polity palette

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The canvas renderer, and decision record 0015

**Files:**
- Create: `packages/viewer/src/render/canvas.ts`, `docs/decisions/0015-no-render-caching.md`
- Test: none automated -- this task is verified by eye, then locked in by Task 7's snapshots upstream of it.

**Interfaces:**
- Consumes: `Frame`, `Draw` (Task 4); `Viewport`, `fitWorld`, `toScreen` (Task 8); `colourFor` (Task 8); `LandArtifact`, `VersionsArtifact`, `COORD_SCALE` from `@history/model`.
- Produces: `class MapRenderer` with `constructor(canvas: HTMLCanvasElement, versions: VersionsArtifact, land: LandArtifact)`, `resize(): void`, `draw(frame: Frame): void`, `readonly viewport: Viewport`.

- [ ] **Step 1: Implement**

`packages/viewer/src/render/canvas.ts`:

```ts
import type { LandArtifact, Polygon, VersionsArtifact } from "@history/model";
import type { Frame } from "../engine/frame";
import { colourFor } from "./palette";
import { type Viewport, fitWorld, toScreen } from "./transform";

/**
 * Three ground tones and nothing else, per decision 0003. The middle tone is
 * also the coverage diagnostic: a year where the plate is mostly bare land is
 * a year the dataset is thin, visible at a glance with no separate overlay.
 */
const SEA = "#101b26";
const LAND = "#2b3440";
const FLASH = "#fdf6e3";

export class MapRenderer {
  readonly viewport: Viewport;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paths = new Map<string, Path2D>();
  private readonly polityOf = new Map<string, string>();
  private readonly areaOf = new Map<string, number>();
  private landPath: Path2D | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly versions: VersionsArtifact,
    private readonly land: LandArtifact,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    for (const r of versions.rows) {
      this.polityOf.set(r.id, r.polityId);
      this.areaOf.set(r.id, r.area);
    }
    this.viewport = fitWorld(canvas.clientWidth, canvas.clientHeight);
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const fitted = fitWorld(width, height);
    Object.assign(this.viewport, fitted);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paths are built in screen space, so a resize invalidates all of them.
    this.paths.clear();
    this.landPath = null;
  }

  draw(frame: Frame): void {
    const { ctx, viewport } = this;
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    if (!this.landPath) {
      this.landPath = this.buildPath(this.land.polygons, this.land.coordScale);
    }
    ctx.fillStyle = LAND;
    ctx.fill(this.landPath);

    // Descending area, so a small polity is never buried under an empire that
    // merely happens to sort later.
    const ordered = [...frame.draws].sort(
      (a, b) => (this.areaOf.get(b.versionId) ?? 0) - (this.areaOf.get(a.versionId) ?? 0),
    );

    for (const d of ordered) {
      const path = this.pathFor(d.versionId);
      if (!path) continue;
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = colourFor(this.polityOf.get(d.versionId) ?? d.versionId);
      ctx.fill(path);
      if (d.flash > 0) {
        ctx.globalAlpha = d.alpha * d.flash * 0.55;
        ctx.fillStyle = FLASH;
        ctx.fill(path);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Built lazily and cached. Bounded at one entry per version, so no eviction
   * is needed, and time-to-first-frame does not pay for 2.4M vertices of path
   * construction up front.
   */
  private pathFor(versionId: string): Path2D | null {
    const cached = this.paths.get(versionId);
    if (cached) return cached;
    const geometry = this.versions.geometry[versionId];
    if (!geometry) return null;
    const path = this.buildPath(geometry.polygons, this.versions.coordScale);
    this.paths.set(versionId, path);
    return path;
  }

  private buildPath(polygons: readonly Polygon[], coordScale: number): Path2D {
    const path = new Path2D();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const [sx, sy] = toScreen(
            this.viewport,
            ring[i] as number,
            ring[i + 1] as number,
            coordScale,
          );
          if (i === 0) path.moveTo(sx, sy);
          else path.lineTo(sx, sy);
        }
        path.closePath();
      }
    }
    return path;
  }
}
```

Note `Frame` comes from `../engine/frame`, not from `@history/model` -- the model owns the artifact contract, the engine owns the render contract. Each artifact carries its own `coordScale`, so `COORD_SCALE` is never needed here.

- [ ] **Step 2: Write decision record 0015**

`docs/decisions/0015-no-render-caching.md`, house format. It must record the measurement, because without the number the absence of caching reads as an omission and someone will add it speculatively.

Content it must contain:

- **Context.** A canvas renderer redrawing an animated scene every frame usually grows layer caching, dirty rectangles or tiling. The coarse artifact holds 2,400,206 vertices, which sounds like it needs them.
- **Decision.** None of them. Full clear-and-redraw every frame from prebuilt `Path2D`, and a linear scan of all 13,380 rows for the active set.
- **Why.** A year is a thin slice of a 5,424-year span. Measured across the whole timeline: median 35 active versions and 1,548 on-screen vertices, p95 147 and 16,066, worst year (2014) 195 and 19,729. Under 20,000 vertices in the worst frame ever drawn.
- **Consequences.** The renderer stays simple enough to reason about whole, and the active-set query behaves identically under playback, scrubbing and jumping with no cursor to invalidate. If profiling later contradicts this, re-take the measurement first -- it is the thing that would have changed. The figures are for the coarse level; Milestone 2's mid and full levels are a different question and this record does not answer it.

- [ ] **Step 3: Commit**

```bash
git add packages/viewer/src/render/canvas.ts docs/decisions/0015-no-render-caching.md
git commit -m "feat(viewer): canvas renderer, and decision 0015 on render caching

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Chrome and wiring

**Files:**
- Create: `packages/viewer/src/ui/chrome.ts`, `packages/viewer/src/ui/chrome.css`
- Modify: `packages/viewer/src/main.ts`, `packages/viewer/index.html`

**Interfaces:**
- Consumes: `Engine` (Task 7), `MapRenderer` (Task 9), `SPEED_STEPS` (Task 2), `Manifest` type from `@history/model`.
- Produces: `class Chrome` with `constructor(root: HTMLElement, engine: Engine)`, `update(frame: Frame): void`.

- [ ] **Step 1: Link the stylesheet**

Add to `packages/viewer/index.html`, inside `<head>`. Vite processes stylesheet
links in the HTML entry, so no CSS import from TypeScript is needed -- which
also avoids having to pull in `vite/client` types just to make `import
"./x.css"` typecheck:

```html
    <link rel="stylesheet" href="/src/ui/chrome.css" />
```

- [ ] **Step 2: Build the chrome**

`packages/viewer/src/ui/chrome.ts`:

```ts
import { SPEED_STEPS } from "../engine/constants";
import type { Engine } from "../engine/engine";
import type { Frame } from "../engine/frame";

/**
 * Years are negative for BCE in the artifact contract. The readout is
 * deliberately the most prominent thing here: per decision 0006 the racing
 * year is the ONLY signal that playback is accelerating. An explicit skip
 * marker was considered and rejected.
 */
function formatYear(year: number): string {
  const y = Math.floor(year);
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}

export class Chrome {
  private readonly readout: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly speeds = new Map<string, HTMLButtonElement>();
  private scrubbing = false;

  constructor(
    root: HTMLElement,
    private readonly engine: Engine,
  ) {
    const [lo, hi] = engine.range;
    root.innerHTML = `
      <div class="bar">
        <button class="play" type="button">Play</button>
        <output class="year"></output>
        <input class="scrub" type="range" min="${lo}" max="${hi + 1}" step="1" value="${lo}" />
        <span class="speeds">
          <button type="button" data-speed="auto">Auto</button>
          ${SPEED_STEPS.map((n) => `<button type="button" data-speed="${n}">${n}x</button>`).join("")}
        </span>
      </div>
      <p class="note">
        Coastlines are modern. Over this range shorelines move: the Aral Sea, the
        Dutch coast and the head of the Persian Gulf are the exceptions worth naming.
      </p>
      <p class="credit">
        Territory from <a href="https://doi.org/10.5281/zenodo.13363121">Cliopatria</a>,
        Seshat Global History Databank (Turchin et al.), CC-BY.
        Land from <a href="https://www.naturalearthdata.com/">Natural Earth</a>, public domain.
      </p>
    `;

    const readout = root.querySelector<HTMLElement>(".year");
    const play = root.querySelector<HTMLButtonElement>(".play");
    const scrubber = root.querySelector<HTMLInputElement>(".scrub");
    if (!readout || !play || !scrubber) throw new Error("chrome failed to build");
    this.readout = readout;
    this.play = play;
    this.scrubber = scrubber;

    play.addEventListener("click", () => {
      engine.playing = !engine.playing;
    });

    // While a drag is in progress, update() must not fight the user for the
    // thumb position.
    scrubber.addEventListener("pointerdown", () => {
      this.scrubbing = true;
    });
    scrubber.addEventListener("pointerup", () => {
      this.scrubbing = false;
    });
    scrubber.addEventListener("input", () => {
      engine.seek(Number(scrubber.value));
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      const value = button.dataset.speed as string;
      this.speeds.set(value, button);
      button.addEventListener("click", () => {
        if (value === "auto") engine.clock.setAuto();
        else engine.clock.setUserSpeed(Number(value));
      });
    }
  }

  /**
   * Reads its state from the frame rather than tracking its own, so the
   * control can never disagree with the engine about what is happening.
   */
  update(frame: Frame): void {
    this.readout.textContent = formatYear(frame.year);
    this.play.textContent = this.engine.playing ? "Pause" : "Play";
    if (!this.scrubbing) this.scrubber.value = String(Math.floor(frame.year));
    const active = frame.mode === "auto" ? "auto" : String(this.engine.clock.userSpeed);
    for (const [value, button] of this.speeds) {
      button.classList.toggle("on", value === active);
    }
  }
}
```

`packages/viewer/src/ui/chrome.css` -- deep map plate, warm retro chrome around
it, per Phase 0's visual direction. The plate fills the window; the chrome sits
over it:

```css
:root {
  --sea: #101b26;
  --chrome: #d9cbb0;
  --chrome-ink: #2b2317;
  --chrome-edge: #a8946f;
}

html,
body {
  margin: 0;
  height: 100%;
  background: var(--sea);
  color: var(--chrome);
  font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
}

#app,
#plate {
  display: block;
  width: 100vw;
  height: 100vh;
}

#chrome {
  position: fixed;
  inset: auto 0 0 0;
  padding: 12px 16px;
  background: linear-gradient(transparent, rgba(16, 27, 38, 0.92) 40%);
}

.bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.year {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
  min-width: 6ch;
  color: var(--chrome);
}

.scrub {
  flex: 1;
}

button {
  background: var(--chrome);
  color: var(--chrome-ink);
  border: 1px solid var(--chrome-edge);
  border-radius: 3px;
  padding: 4px 10px;
  cursor: pointer;
  font: inherit;
}

button.on {
  background: var(--chrome-ink);
  color: var(--chrome);
}

.note,
.credit {
  margin: 6px 0 0;
  font-size: 11px;
  opacity: 0.65;
}

.credit a {
  color: inherit;
}
```

- [ ] **Step 3: Wire main.ts**

Replace the body of `packages/viewer/src/main.ts`:

```ts
import { Engine } from "./engine/engine";
import { fetchArtifacts } from "./data/artifacts";
import { MapRenderer } from "./render/canvas";
import { Chrome } from "./ui/chrome";

async function start(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("#app is missing from index.html");

  // versions.0.json is 3 MB gzipped but 35.3 MB uncompressed, so the parse is
  // the dominant cost, not the download. Say so rather than showing a blank
  // canvas.
  app.innerHTML = '<p class="loading">Loading the atlas...</p>';

  let artifacts: Awaited<ReturnType<typeof fetchArtifacts>>;
  try {
    artifacts = await fetchArtifacts();
  } catch (error) {
    app.innerHTML = `<p class="error">Could not load the map data: ${String(error)}</p>`;
    return;
  }

  app.innerHTML = '<canvas id="plate"></canvas><div id="chrome"></div>';
  const canvas = app.querySelector<HTMLCanvasElement>("#plate");
  const chromeRoot = app.querySelector<HTMLElement>("#chrome");
  if (!canvas || !chromeRoot) throw new Error("app shell failed to build");

  const engine = new Engine(artifacts.versions);
  const renderer = new MapRenderer(canvas, artifacts.versions, artifacts.land);
  const chrome = new Chrome(chromeRoot, engine);

  window.addEventListener("resize", () => renderer.resize());

  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const frame = engine.advance(dt);
    renderer.draw(frame);
    chrome.update(frame);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
```

The `Math.min(dt, 0.1)` guard matters: a backgrounded tab produces a multi-second `dt`, which would otherwise jump the year forward by a century in one step.

- [ ] **Step 4: Verify by eye**

```bash
pnpm build          # produces dist/ if you have not already
pnpm dev
```

Check, against the real data and not the fixture:

- Land reads as distinct from sea, and territory is the only saturated thing on screen.
- Playback runs; the year readout races in empty stretches and settles before a change lands.
- Selecting a numeric speed stops all acceleration. Returning to Auto resumes it.
- The scrubber jumps anywhere in the range and the map follows.
- Attribution and the coastline note are both visible.

Also record the `viewport.scale` at a typical window size (log it once): that is the real pixels-per-projected-unit figure, and Milestone 2 needs it to replace `PX_PER_UNIT`.

- [ ] **Step 5: Commit**

```bash
git add packages/viewer/src packages/viewer/index.html
git commit -m "feat(viewer): chrome, attribution, and the animation loop

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Deployment, the coverage check, and documentation

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/full-build.yml`, `.github/workflows/ci.yml`, `README.md`, `docs/architecture.md`, `packages/viewer/README.md` (create)

**Interfaces:** none -- this task ships what the previous ten built.

- [ ] **Step 1: Add the coverage check to the full build**

Acceptance criterion 14 is a property of the real dataset, not the fixture --
the fixture is a deliberately sparse 47-version slice with 2,180 uncovered
years -- so it belongs beside the existing 8 MB budget check in
`.github/workflows/full-build.yml`, not in `pnpm test`. Sampled at mid-year,
which is what playback actually renders, the current build has zero empty
years.

Add this step to `full-build.yml`, after the size report and before the
artifact upload:

```yaml
      - name: Every year renders something (acceptance criterion 14)
        run: |
          node -e "
            const rows = require('./dist/versions.0.json').rows;
            const FADE = 0.4 * 4;
            const lo = Math.min(...rows.map((r) => r.fromYear));
            const hi = Math.max(...rows.map((r) => r.toYear));
            const empty = [];
            for (let y = lo; y <= hi; y++) {
              const t = y + 0.5;
              let live = false;
              for (const r of rows) {
                const fade = Math.min(FADE, (r.toYear - r.fromYear + 1) / 2);
                if (t >= r.fromYear && t < r.toYear + 1 + fade) { live = true; break; }
              }
              if (!live) empty.push(y);
            }
            if (empty.length) {
              console.error('years with nothing on screen:', empty.length, empty.slice(0, 20));
              process.exit(1);
            }
            console.log('every year from ' + lo + ' to ' + hi + ' renders at least one version');
          "
```

- [ ] **Step 2: Add the deploy workflow**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # The pinned sources are ~46 MB and change only when sources.ts does,
      # so this keeps the download off every deploy.
      - name: Cache the downloaded sources
        uses: actions/cache@v4
        with:
          path: data
          key: sources-${{ hashFiles('packages/pipeline/src/sources.ts') }}

      - run: pnpm fetch:sources
      - run: pnpm build
      # Vite's publicDir points at dist/, so this copies the artifacts into the
      # site: the app and its data always ship from one commit.
      - run: pnpm --filter @history/viewer build

      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: packages/viewer/dist-app
      - id: deployment
        uses: actions/deploy-pages@v4
```

Two settings this depends on:

1. In the repository settings, set **Pages -> Build and deployment -> Source**
   to **GitHub Actions**.
2. The site is served from a subpath (`https://<user>.github.io/mankind-history/`),
   so add `base: "/mankind-history/"` to `packages/viewer/vite.config.ts`.
   `fetchArtifacts` already defaults to a relative base (`"."`), which resolves
   correctly under a subpath; a leading slash would 404.

Also extend `.github/workflows/ci.yml` to build the viewer, so a broken build
fails the PR rather than the deploy:

```yaml
      - run: pnpm --filter @history/viewer build
```

- [ ] **Step 3: Update the documentation**

- `README.md`: change "Phase 2, the viewer, has not started" to describe what Milestone 1 ships, and add the live URL. Add `pnpm dev` to the Quickstart.
- `docs/architecture.md`: the package boundary section still says `viewer/` is "Phase 2. Will depend on..." -- make it present tense, and add a short section on the engine/renderer split and why the engine is DOM-free.
- `packages/viewer/README.md`: what the package is, how to run it, the engine/render/ui boundary, and the rule that the engine imports no DOM.

- [ ] **Step 4: Full verification**

```bash
nvm use
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test
pnpm build
pnpm --filter @history/viewer build
```

- [ ] **Step 5: Commit and open the pull request**

```bash
git add .github README.md docs packages/viewer/README.md
git commit -m "feat(viewer): deploy to Pages, and the full-build coverage check

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Then push the branch and open a PR against `main`. `main` is protected: never push to it directly.

---

## Milestone exit conditions

These are not tests, and the milestone is not done without them.

- [ ] **Deployed to a public URL**, serving the app and its data from one commit (criterion 20).
- [ ] **The feel session** (criterion 21). The project owner watches it and judges the two things Phase 0 could not:
  1. **Does adaptive playback feel right?** Phase 0 warned that it "was reasoned into existence after the spike, not felt", and the acceleration fraction came back at 37% / 37% / 54% / 62%. If it feels wrong, the fix is contained in `clock.ts` and `constants.ts`.
  2. **Does the 16-hue palette hold up at real density?** Up to 195 polities are on screen at once. Phase 0 recorded the fallback: fewer hues with more lightness separation, not more hues.
- [ ] **Record `viewport.scale`** at a real window size, for Milestone 2 to replace `PX_PER_UNIT` with.

Both judgements are permitted to change the design. That is why this milestone is first.
