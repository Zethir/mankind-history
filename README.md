# History map

An interactive map of political territory over time. Scrub, jump to a year,
or autoplay, and watch the borders of tribes, empires and states change
across the world.

## The non-negotiable

From `docs/standards.md`:

> Never assert something the data cannot support.

Concretely: no interpolated geometry, no clipping that creates a border that
never existed, no fabricated confidence values, no flash on unattributable
growth. Gaps in the data render as gaps on the map, not as a guess. A visible
gap is an invitation to contribute; a seamless-looking map that quietly
guessed is not.

## Status

Phase 0 (the playback spike) is closed. Findings are in
`docs/phase-0-findings.md`.

Phase 1 is complete: `pnpm fetch:sources && pnpm build` turns the pinned
upstream sources into a validated `dist/`, and every Phase 1 acceptance
criterion is a named test. See `docs/architecture.md` for how the pipeline
gets there.

A full build produces eight artifacts, measured on the pinned Cliopatria
release (1,583 polities, 13,380 versions):

| file | detail | gzipped |
| --- | --- | --- |
| `polities.json` | - | 45 KB |
| `versions.2.json` | full | 12.63 MB |
| `versions.1.json` | mid, 60% simplified | 4.68 MB |
| `versions.0.json` | coarse, 30% simplified | 3.02 MB (8 MB budget) |
| `land.0.json` | coarse | 31 KB |
| `land.1.json` | mid | 403 KB |
| `changes.json` | change-year index | 33 KB |
| `manifest.json` | provenance | - |

Phase 2, Milestone 1 ships the viewer: a DOM-free playback engine, a canvas
renderer, and the chrome (play/pause, scrub, speed) around them, all built
against `versions.0.json`. Deployment to GitHub Pages is wired - see
`.github/workflows/deploy.yml` - but has not yet run, so there is no live URL
to link here. The milestone's exit condition is a human watching the result
and judging whether adaptive playback and the palette hold up at real
density; that judgement is still outstanding. See `docs/architecture.md` and
`packages/viewer/README.md`.

## Quickstart

```bash
nvm use               # Node 22
pnpm install
pnpm fetch:sources     # downloads and checksum-verifies the pinned sources into data/
pnpm build             # writes dist/
pnpm test
pnpm dev               # runs the viewer against dist/ (or the fixture, if dist/ is absent)
```

`pnpm fetch:sources` downloads about 46 MB once, 165 MB after unpacking.
`pnpm test` itself needs no download - it runs against the committed fixture
in `fixtures/`.

## Layout

```
packages/
  model/      canonical types, Equal Earth projection, artifact contract
  pipeline/   fetch, build, extract-fixture and histogram commands. Depends
              on model.
  viewer/     the viewer. Depends on model (types) and dist/ (data), never
              on pipeline.
docs/         specs and decision records
fixtures/     small committed real slice, for tests and first run
data/         gitignored. Downloads and intermediates.
dist/         gitignored. Build output, released as artifacts, not committed.
```

## Where to read more

Start with `docs/architecture.md` - the narrative a new contributor should
read first.

Then `docs/decisions/`, the numbered decision records: what was decided and
what it cost. If a record rules something out and you want to do it anyway,
argue against the record explicitly rather than quietly going around it. If
you are wondering why the obvious 700+-star dataset isn't the primary source,
that's 0008.

Beyond that: the phase specs (`docs/phase-0-findings.md`,
`docs/phase-1-importer.md`, `docs/phase-1-design.md`), `docs/data-sources.md`
for what is pinned and why, and `docs/standards.md` for the rules this
project holds itself to.

## Attribution

Cliopatria, Seshat Global History Databank. Turchin et al. CC-BY.
<https://doi.org/10.5281/zenodo.13363121>

Natural Earth. Public domain, no attribution required.
<https://www.naturalearthdata.com/>

Attribution also ships in `dist/manifest.json` and will ship in the UI - per
`docs/standards.md`, attribution belongs in the build output and the
interface, not just a README.

## Licence

MIT. Code licence is a free choice today because every dataset currently
used is CC-BY or public domain. Adopting `historical-basemaps` later (see
decision 0005) would make this project GPL-3.0; that is a deliberate,
recorded decision, not something that happens by accident.
