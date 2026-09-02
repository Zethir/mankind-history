# Phase 1 — implementation design

Companion to `docs/phase-1-importer.md`. That document is the canonical phase
spec: the output contract, the canonical model, the eight stages and the
acceptance criteria. This one records the architecture and the decisions taken
while brainstorming the implementation, so the plan can be written against
something concrete.

Where the two disagree, `phase-1-importer.md` wins on *what* and this document
wins on *how*.

## Scope and milestones

Phase 1 processes the **entire** Cliopatria dataset — whole world, 3400 BCE to
2024 CE — plus Natural Earth land, into the `dist/` artifact set. It is not
region- or era-scoped; the Phase 0 spike was, this is not.

The work is split into two milestones with the same end state:

**Milestone 1 — the vertical slice.** `fetch → normalise → resolve identity →
derive lineage → project → emit`, producing a valid single-detail-level artifact
set (`polities.json`, `versions.2.json`, `land.0.json`, `land.1.json`,
`manifest.json`). Green tests for lineage, geometry validity, un-projection
round-trip, antimeridian, identity, determinism, and manifest completeness.

**Milestone 2 — hardening.** Topology-preserving simplification at the two
coarser levels (`versions.1.json`, `versions.0.json`), the spatially-bucketed
change-year index (`changes.json`), and their tests (no-new-gaps, 1,000-pair
index equivalence, 8 MB gzipped budget).

Rationale: simplification and the spatial index are the two parts most likely to
churn, and everything downstream — including an early Phase 2 viewer spike — only
needs a valid full-detail artifact set to begin. M1 gives that early.

## Decisions taken while brainstorming

| # | Decision |
|---|---|
| D1 | **Fetch is an automated, checksum-pinning downloader** the pipeline owns, not a manual drop into `data/`. |
| D2 | **Milestone split (above).** Vertical slice first, hardening second. |
| D3 | **Polity identity** keys on `wd:<Wikidata>`, falls back to `name:<normalizedName>` (decision 0007). `aliases.json` lives at `packages/pipeline/aliases.json`. |
| D4 | **The drift report is deferred past Phase 1.** The schema still stores `normalizedName` and `seshat` on every polity so the future report has data to diff. |
| D5 | **Fixtures** are a deterministic carve from the fetched full dataset: Mediterranean bbox ∪ a small antimeridian strip for Cliopatria, the same two bboxes from both `ne_110m_land` and `ne_50m_land`, all years, well under ~1 MB committed. Golden output artifacts committed alongside. |
| D6 | **Pipeline structure:** in-process pure-function pipeline for the core transform, with `fetch` (network) and `simplify` (mapshaper, CPU) pulled out as separate cached commands writing into `data/`. |
| D7 | **Node 22**, pinned via `.nvmrc`, installed via nvm. |
| D8 | **Coordinates are scaled integers** (`Math.round(projected * scale)`), scale pinned per detail level in `canon.ts`. Determinism by construction rather than by float rounding. |
| D9 | **Per-version projected `bbox` and label `anchor`** are emitted with geometry from M1. The bbox is load-bearing for the M2 index and for 0006's viewport-scoped `nextVisibleChange`; the anchor rides along for near-zero cost and serves future name labels. |
| D10 | **No wall-clock time in any `dist/` file.** Provenance is upstream versions + checksums. |
| D11 | **Code licence: MIT.** Free choice today per 0005; MIT → GPL-3.0 later (if historical-basemaps is ever adopted) is a clean one-way move. |
| D12 | **Antimeridian-crossing geometry is cut at ±180° before projecting.** Gets its own decision record — see below. |
| D13 | External identifiers (`wikidata`, `wikipedia`, `seshat`) are **reference identifiers for future enrichment joins**, not "the click-to-leave link". No prose/description fields are added now (YAGNI, and an empty prose field invites unlicensed text). In-app historical detail is a future phase with a licensing decision attached, and lands additively as a new `polity-detail.json` artifact keyed by polity id. |

### New decision records to author during implementation

- **00xx — Antimeridian handling.** Rings that wrap the ±180° line are cut into
  east/west pieces along the antimeridian before projection. The cut runs along
  a meridian at the map's edge and carries no territorial claim; without it the
  polygon projects to a stripe across the whole map, which is a worse falsehood
  than the cut. This is the one place the pipeline splits geometry, so it is
  recorded explicitly.
- **00xx — Determinism is scoped to the pinned toolchain.** Byte-identical
  output is guaranteed for the Node version in `.nvmrc` and the pinned mapshaper
  version, because floating-point results (projection maths, simplification)
  depend on the engine. Bumping either is a deliberate act with a re-bless of
  the golden artifacts.

## Workspace and layout

pnpm workspace at the repo root.

```
package.json            workspace root: scripts, devDeps (biome, vitest, typescript)
pnpm-workspace.yaml
.nvmrc                   22
biome.json              one config, checked in, no per-editor overrides
tsconfig.base.json      strict: true, ESM, Node 22 lib, noEmit (tsx runs sources directly)
vitest.config.ts        workspace-level
.editorconfig
LICENSE                 MIT

packages/
  model/                @history/model  — no runtime deps
    src/
      types.ts          Polity, Version, Manifest, artifact file shapes
      canon.ts          projection id, per-level coord scales, per-level px/unit,
                        grid dimensions, level names
      projection.ts     Equal Earth forward + iterative inverse (ported from spike)
      normalize-name.ts the normalizedName rule
      artifact.ts       deterministic JSON writer + typed reader
    tests/
  pipeline/             @history/pipeline  — depends on @history/model
    src/
      sources.ts        pinned source manifest: versions, URLs, sha256
      cli.ts            fetch | build | simplify | extract-fixture | fixture:bless
      fetch/            download + checksum verify + unpack
      stages/
        normalise.ts
        identity.ts
        lineage.ts
        project.ts
        antimeridian.ts
        simplify.ts     (M2)
        index.ts        (M2)
        emit.ts
      build.ts          composes M1 stages in-process
    aliases.json        hand-maintained polity-identity fixes (0007)
    overlaps.json       whitelisted lineage overlaps, each with a reason
    tests/              one file per acceptance criterion, named after it

fixtures/
  cliopatria.geojson    committed real slice (raw, pre-filter)
  ne_110m_land.geojson  committed real slice
  ne_50m_land.geojson   committed real slice
  dist/                 golden build output of the slice

docs/
  architecture.md       new — the narrative a contributor reads first
  decisions/            new ADRs land here
  phase-1-design.md     this document

.github/workflows/
  ci.yml                fixture lane: install → biome → typecheck → vitest
  full-build.yml        manual dispatch: full-dataset build + slow checks
```

`packages/viewer/` is **not** created in Phase 1 — it is Phase 2. The workspace
is laid out so it slots in later importing `@history/model` only, never
`@history/pipeline` (0009).

`projection.ts` lives in `model`, not `pipeline`: "projected" is part of the
artifact contract, and the round-trip test needs the inverse. The viewer gets it
from the same package.

## The `model` package

### Canonical types

The spec's canonical model as `strict` TypeScript — a `Version` missing `gap`
fails at compile time.

```ts
interface Polity {
  id: string;               // "wd:Q1747689"  |  "name:kingdom-of-numidia"
  name: string;
  normalizedName: string;   // see normalize-name.ts
  wikidata: string | null;  // "Q1747689"
  wikipedia: string | null; // canonical form decided against real data, normalised on ingest
  seshat: string | null;    // SeshatID
}

interface Version {
  id: string;               // `${polityId}@${fromYear}` — unique by acceptance criterion
  polityId: string;
  fromYear: number;         // integer, negative for BCE
  toYear: number;
  area: number;             // km², from Cliopatria Area
  prevId: string | null;    // previous version of the same polity — null on first appearance
  delta: number | null;     // area − prev.area — null on first appearance
  gap: number | null;       // max(0, fromYear − prev.toYear) — null on first appearance
  confidence: number | null;// ALWAYS null in Phase 1 (decision 0005)
  source: { dataset: "cliopatria"; version: string };
}
```

`normalizedName` rule (pinned in `model`, tested): lowercase, Unicode NFKD,
strip diacritics, replace runs of non-alphanumeric with a single `-`, trim
leading/trailing `-`.

### ID strategy

`wd:${Wikidata}` when the row carries a Wikidata id, else `name:${normalizedName}`.
`aliases.json` maps an upstream `name` or `wikidata` value onto a canonical
polity id, applied during identity resolution. Expected to be near-empty in
Phase 1; the machinery exists.

Version id `${polityId}@${fromYear}` is unique because "no polity has two
versions with the same from_year" is an acceptance criterion — a violation fails
the build, forcing a fix rather than being papered over.

### Artifact files

Each `versions.{level}.json` is **self-contained** — version rows *and* projected
geometry at that detail level — because the viewer loads exactly one level per
zoom and wants a single fetch. Row metadata is duplicated across levels; it is
small next to geometry, and the typed-array/protobuf escape hatch in the spec is
the release valve if that ever matters.

```
polities.json    { schemaVersion, polities: Polity[] }
versions.2.json  { schemaVersion, level: "full", rows: Version[],
                   geometry: { [versionId]: { polygons, bbox, anchor } } }
versions.1.json  (M2)  level "mid"
versions.0.json  (M2)  level "coarse"
land.0.json      { schemaVersion, level, polygons }   Natural Earth 110m, projected
land.1.json      Natural Earth 50m, projected
changes.json     (M2)  { schemaVersion, grid: { cols, rows, bounds }, cells: number[][] }
manifest.json    sources + upstream versions + licences + per-artifact
                 { file, bytes, gzipBytes, sha256, detail }. No wall-clock time.
```

Geometry shape: `polygons` is `polygon → ring → flat [x0,y0,x1,y1,…]` (spike
precedent). `bbox` is `[minX, minY, maxX, maxY]` in scaled-integer projected
units. `anchor` is `[x, y]`, the polygon's pole of inaccessibility, for future
name-label placement.

### `canon.ts`

Every shared constant, one place, imported by both packages:

- `PROJECTION = "equal-earth"`
- per-level coordinate scales — `full: 1e8`, `mid: 1e6`, `coarse: 1e5`
  (`full` chosen so un-projection round-trips within 1e-6°: the Equal Earth
  x-gradient is ≈ 68 °/unit, so a 1e-8 quantum is ≈ 3e-7° of error, comfortably
  inside the bound; verified by a test)
- per-level "coarsest zoom served" in px/projected-unit (M2 gap check)
- change-index grid dimensions — start `64 × 32`

### `artifact.ts`

The read/write contract from 0009:

- **writer** — deterministic: explicit key order per file shape, `\n` line
  endings, trailing newline, no BOM, geometry values are integers only.
- **reader** — typed, returns the `types.ts` interfaces.

Pipeline writes, viewer reads, both typed.

## `pipeline fetch`

### `sources.ts`

The pinned manifest, committed, the single source of truth for "the inputs":

```ts
export const SOURCES = {
  cliopatria: {
    name: "Cliopatria (Seshat Global History Databank)",
    license: "CC-BY-4.0",
    upstreamVersion: "<pinned Zenodo record version>",
    url: "https://zenodo.org/records/<id>/files/cliopatria.geojson.zip",
    sha256: "<pinned>",
    unpack: "cliopatria.geojson",
  },
  naturalEarth110mLand: {
    name: "Natural Earth — land (110m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_110m_land.geojson",
    sha256: "<pinned>",
  },
  naturalEarth50mLand: { /* ne_50m_land at the same tag */ },
} as const;
```

### Flow

`pipeline fetch` downloads each source into `data/sources/`, verifies SHA-256,
**fails hard on mismatch** — never proceeds with unverified input — and unpacks
where needed. Already-present-and-verified files are skipped; `--refresh`
re-downloads.

`pipeline fetch --write-pins` downloads, computes checksums, and prints the
`sources.ts` block to paste. Used once when adding a source or bumping a
version, then committed. Normal `fetch` never writes pins.

The emit stage copies `name` / `license` / `upstreamVersion` / `url` / `sha256`
straight from `sources.ts` into `manifest.json`, so every shipped artifact set
names its exact inputs and their licences.

Bumping a source is deliberate (`docs/data-sources.md`): edit the pin, re-fetch,
re-run, re-run acceptance checks, diff the change-year index, re-bless fixtures.

## `pipeline build` — Milestone 1

`pipeline build --sources data/sources --out dist` runs the stages in-process.
`--dump-intermediates data/debug` optionally writes each stage's output.

**1. Normalise.** Parse Cliopatria (raised heap for M1; `stream-json` is the
fallback if it OOMs). Keep `Type === "POLITY"` case-insensitively — report the
RELATION drop count. Coerce years (spike's `toYear`: string years, negatives),
coerce `Area` to number, normalise the `Wikipedia` field to a canonical form
(decided against real data). Drop rows with unusable years or empty/degenerate
geometry — each drop counted and printed. Natural Earth: geometry only, no
properties.

**2. Resolve identity.** Group rows into polities by the ID strategy above;
apply `aliases.json`; build `Polity[]`.

**3. Derive lineage.** Per polity, sort versions by `(fromYear, toYear)`. For
each consecutive pair set `prevId`, `delta = area − prev.area`,
`gap = max(0, fromYear − prev.toYear)`. First version: three nulls. Two
conditions fail the build:

- **same `fromYear` twice for one polity** — breaks the version id; no
  whitelist, forces a fix.
- **overlap** (`fromYear <= prev.toYear`) — unless listed in `overlaps.json`
  with a reason. The count is always reported.

**4. Project.** Equal Earth forward on every ring.

- **Antimeridian** (`antimeridian.ts`): a ring whose longitude extent indicates
  wrapping is cut at ±180° into east/west pieces *before* projection. Build
  reports which polities were cut. See decision record D12.
- Per version, compute the projected `bbox` and the label `anchor` (pole of
  inaccessibility).
- Round every coordinate to scaled integers at the `full` scale.

**5. Emit.** Deterministic writer → `polities.json`, `versions.2.json`,
`land.0.json`, `land.1.json`, then `manifest.json` (which hashes the rest). M1
does **not** emit `versions.0/1.json` or `changes.json`.

### Determinism rules

- No wall-clock time anywhere in `dist/`.
- Explicit sorts: polities by `id`; versions by `(polityId, fromYear, toYear)`;
  geometry polygon/ring order preserved from source order.
- Scaled-integer coordinates.
- JSON: fixed key order, `\n` endings, trailing newline, no BOM.
- Projection is a pure function; V8 maths is deterministic for the pinned Node
  version. Determinism is scoped to the pinned toolchain (decision record).
- Inputs are checksum-pinned, so "identical inputs" is guaranteed.

## Milestone 2 — simplification and the change-index

### `pipeline simplify`

mapshaper via its programmatic API (`mapshaper.applyCommands`), pinned version,
cached in `data/simplified/`. Input is the **projected** full-detail geometry.
All polities go through **one mapshaper call per level** so topology is shared —
Visvalingam weighted, `keep-shapes`, topology on (mapshaper default) so shared
arcs stay identical between neighbours and borders cannot crack into hairline
gaps. Two levels:

- `versions.1.json` — "mid", regional zoom.
- `versions.0.json` — "coarse", global zoom; its simplification percentage is
  tuned down until `versions.0.json` + `changes.json` gzip under 8 MB.

Determinism: pinned mapshaper, single-threaded, deterministic algorithm —
verified by a twice-run byte-identical test.

Caveat, noted in code: mapshaper builds topology across all polities, including
temporally-disjoint ones that never share a screen. This slightly
over-constrains simplification but is harmless and keeps the one-call-per-level
rule simple.

### `changes.json`

Uniform grid over the Equal Earth projected bounds, dimensions in `canon.ts`
(start `64 × 32`). For each version, add `fromYear` and `toYear` to every grid
cell its projected bbox overlaps. Serialised row-major; each cell a sorted
deduped year list; plus `{ cols, rows, bounds }`.

Viewer query, and the test's subject: given `(year T, bbox B)` → cells
overlapping `B` → merge their sorted lists → first year `> T`. This backs
0006's viewport-scoped `nextVisibleChange`.

### No-new-gaps check

mapshaper's shared-topology simplification keeps shared arcs identical between
neighbours, so gaps cannot open by construction. The test verifies the property
held: sample along boundaries adjacent in full detail, measure the maximum
separation in the simplified level, assert it is under one pixel at that level's
"coarsest zoom served" figure. It is a guard against anyone swapping in
per-polygon simplification.

## Fixtures, golden artifacts, tests

### `pipeline extract-fixture`

Deterministic carve from the fetched full dataset into `fixtures/`:

- Cliopatria: Mediterranean bbox `[-10, 25, 45, 50]` ∪ a small antimeridian
  strip (e.g. the Aleutians/Kamchatka or Fiji), all years, raw pre-filter
  GeoJSON — the `Type` filter is *not* applied so RELATION rows are present for
  the filter test; string-typed year rows kept if the real data has them.
- Natural Earth: the same two bboxes from both `ne_110m_land` and `ne_50m_land`,
  so the fixture build exercises both `land.0.json` and `land.1.json`.
- Target well under ~1 MB committed.
- Regenerated deliberately when Cliopatria bumps; the diff is reviewed.

### Golden artifacts

`fixtures/dist/` holds a committed full build of the fixture slice, regenerated
by an explicit `pnpm fixture:bless`. Any unintended change is a git diff in
review. This is the regression net and the determinism check in one.

### Tests

`packages/pipeline/tests/`, one file per acceptance criterion, each named after
the criterion. Fast lane runs against the fixture.

| Criterion | Milestone |
|---|---|
| prev_id / delta / gap present, or all-null on first appearance | M1 |
| no polity has two versions with the same from_year | M1 |
| overlapping versions reported, zero-or-whitelisted | M1 |
| delta == area − prev.area | M1 |
| rings closed, ≥4 points, no NaN/inf | M1 |
| un-projecting any coordinate round-trips within 1e-6° | M1 |
| no polygon crosses the antimeridian in projected space | M1 |
| build is deterministic (byte-identical on re-run) | M1 |
| manifest names every source with version + licence | M1 |
| identity keys on wikidata, falls back to normalised name | M1 |
| confidence is unpopulated (0005) | M1 |
| no previously-adjacent polygons gain a >1px gap after simplification | M2 |
| 1,000 random (year, bbox) index lookups match brute force | M2 |
| coarsest global artifact under 8 MB gzipped | M2 |

The determinism, manifest, and 8 MB tests also run in the slow/manual CI lane
against a full-dataset build.

## CLI and scripts

Root `package.json` scripts: `fetch`, `build`, `simplify`, `test`, `lint`,
`typecheck`, `fixture:bless`. The `pipeline` bin backs them; each subcommand
takes explicit `--sources` / `--out` / `--input` paths — no working-directory
magic (`docs/standards.md`).

## Documentation and scaffolding

The current `README.md` is the Phase 0 spike readme and is replaced.

- **`README.md`** — what the project is, the data-honesty non-negotiable and the
  hard constraints in brief, a quickstart (`nvm use` → `pnpm install` →
  `pnpm fetch` → `pnpm build` → `pnpm test`), the repo layout, links to
  `docs/decisions/`, the phase specs, `docs/architecture.md`. Attribution for
  Cliopatria and Natural Earth.
- **`docs/architecture.md`** — the model/pipeline/viewer boundary and why it is
  enforced (0009), the artifact contract, the eight stages end to end, why it is
  a static build and not a database (and when that changes — Phase 4).
- **`CONTRIBUTING.md`** — environment setup, the `pnpm` scripts, how each test
  maps to an acceptance criterion, Biome, the determinism rules a contributor
  must not break, and when to write a decision record. Notes the deliberately
  deferred files (`CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates,
  `CHANGELOG.md`).
- **`packages/model/README.md`** — the canonical types, the artifact contract,
  the projection.
- **`packages/pipeline/README.md`** — the CLI commands, what each reads and
  writes, full build vs. fixture.
- **`.github/workflows/ci.yml`** — `pnpm install` → Biome → typecheck → Vitest,
  against the fixture. **`full-build.yml`** — manual dispatch, full-dataset build
  plus the slow determinism / manifest / budget checks.

Closing Phase 1 also removes the spike (`scripts/`, `src/`, `index.html`, the
spike `README.md`) and updates CLAUDE.md's "Current state" section — kept short —
to point at the real structure.

## Out of scope / deferred

- **`packages/viewer/`** — Phase 2.
- **The drift report** (0007) — past Phase 1; schema keeps the data to diff.
- **`confidence` population** — stays null until historical-basemaps is adopted
  (0005). Tests assert it is null.
- **`RELATION` rows** — dropped; rendering them is a Phase 3 question.
- **In-app historical detail content** — a future phase with its own licensing
  decision, additive as a new `polity-detail.json` artifact.
- **PostGIS / a database** — Phase 4, when there is authoring and concurrent
  edits.
- **Typed arrays / protobuf artifact encoding** — the escape hatch if the 8 MB
  budget is exceeded; not pre-optimised.

## Assumptions to confirm against real data during implementation

- Exact Cliopatria property names and the `Wikipedia` field format (title, slug,
  or URL).
- Whether year fields actually arrive as strings in the current release.
- Whether the current release has same-`fromYear` duplicate rows or overlapping
  versions that need `overlaps.json` entries.
- The pinned Zenodo record id/version and the two Natural Earth checksums.
- Whether raised-heap parsing is sufficient or `stream-json` is needed.
