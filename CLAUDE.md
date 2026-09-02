# History map

An interactive map of political territory over time. Scrub, jump to a year, or
autoplay, and watch the borders of tribes, empires and states change across the
world. Public, open-source release is the goal.

Read `docs/decisions/` before proposing architectural changes. Each record says
what was decided and what it cost. If you want to do something a record rules
out, say so explicitly and argue it — do not quietly do it.

## Hard constraints

- **Licensing.** Currently CC-BY and public-domain sources only, which leaves the
  code licence a free choice. CShapes 2.0 is CC BY-NC-SA and is ruled out.
  `historical-basemaps` is GPL-3.0: usable, but adopting it makes this whole
  project GPL-3.0, so it is a deliberate decision, not an incremental data
  addition. See 0005 and 0008. Attribution stays in the build output and the UI.
- **Never invent geometry.** No polygon morphing, no interpolated borders, no
  clipping that creates a border that never existed. Missing coverage renders as
  absence, not as a guess.
- **Never dramatise what the data cannot support.** The expansion flash is
  suppressed across long sampling gaps. Same principle as above.
- **Equal-area projection.** Equal Earth, pre-projected at build time. No Web
  Mercator, no map library, no tile basemap.
- **Land and sea only** for the ground layer. No rivers, lakes, modern borders or
  labels. The bare-land tone doubles as the "no data here" state.

## Layout

pnpm workspaces. See 0009.

```
packages/model/      canonical types + artifact contract
packages/pipeline/   build. Depends on model.
packages/viewer/     depends on model (types) and dist/ (data). Never on pipeline.
docs/                specs and decision records
fixtures/            small committed real slice, for tests and first-run
data/                gitignored. Downloads and intermediates.
dist/                gitignored. Build output. Released as artifacts, not committed.
```

## Current state

Phase 0 is closed. Findings: `docs/phase-0-findings.md`.
Phase 1 is the data spine: `docs/phase-1-importer.md`.

The code currently in `scripts/` and `src/` is the Phase 0 spike. It is
deliberately disposable: no schema, no validation, no tests. Do not extend it,
and do not treat its structure as precedent.
