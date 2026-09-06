# @history/pipeline

The build: fetch, normalise, resolve identity, derive lineage, project, emit.
Depends on `@history/model` for types, the projection and the artifact
writer. Never imported by the viewer (decision 0009).

## Commands

All four are subcommands of `packages/pipeline/src/cli.ts`, invoked through
the root `package.json` scripts. Every path is an explicit flag - no
implicit working-directory magic (`docs/standards.md`).

### `fetch` (`pnpm fetch:sources`)

Downloads every source in `sources.ts` into `data/sources/`, verifies its
SHA-256, and unpacks it where needed (currently just Cliopatria's zip).
Already-present, already-verified files are skipped.

```
pnpm fetch:sources                              # into data/sources
pnpm fetch:sources -- --sources=data/other       # different destination
pnpm fetch:sources -- --refresh                  # re-download even if cached
pnpm fetch:sources -- --write-pins               # see "Bumping a source" below
```

Note the script name: it's `fetch:sources`, not `fetch`. `pnpm fetch` is a
pnpm built-in and would shadow this script entirely.

Reads: nothing (network only). Writes: `data/sources/*`.

### `build` (`pnpm build`)

Runs the pipeline stages in-process against already-fetched sources and
writes the `dist/` artifact set: `polities.json`, `versions.0/1/2.json`,
`land.0.json`, `land.1.json`, `changes.json`, `manifest.json`.

```
pnpm build                                    # data/sources -> dist
pnpm build -- --sources=fixtures --out=fixtures/dist   # what fixture:bless runs
```

Reads: `<--sources>/cliopatria_polities_only.geojson`,
`<--sources>/ne_110m_land.geojson`, `<--sources>/ne_50m_land.geojson`,
`packages/pipeline/aliases.json`, `packages/pipeline/overlaps.json`. Writes:
`<--out>/*`.

`fetch` and `build` are deliberately separate commands rather than one
`build --fetch` step, so iterating on the transform never re-downloads
~100 MB.

### `extract-fixture` (`pnpm extract-fixture`)

Carves the small, committed `fixtures/` slice out of the fetched full
dataset - see `fixtures/README.md` for the selection rule (whole-feature, by
vertex, inside a small box around Rome) and why it exists.

```
pnpm extract-fixture                          # data/sources -> fixtures
```

Reads: the same three files as `build`, from `<--sources>` (default
`data/sources`). Writes: `<--out>/*.geojson` (default `fixtures`).

### `histogram` (`pnpm histogram`)

Reads `dist/changes.json` and reports, per region, how change years are
distributed over time and how much decision 0006's viewport-scoped playback
acceleration would engage there - the number Phase 0 asked for and nothing
until this stage could produce. Prints an ASCII bar chart of distinct change
years per bucket plus the acceleration summary; `--out` also writes the
result as JSON.

```
pnpm histogram                                 # all four Phase 0 regions, all years
pnpm histogram -- --region=subsaharan          # one named region (see regions.ts)
pnpm histogram -- --bbox=-10,25,45,50          # minLon,minLat,maxLon,maxLat
pnpm histogram -- --era=classical              # named era (see regions.ts)
pnpm histogram -- --from=-500 --to=500         # explicit year range
pnpm histogram -- --bucket=100                 # years per histogram bucket
pnpm histogram -- --speed=4 --deadtime=7       # yr/s and dead-time ceiling (seconds)
pnpm histogram -- --dist=dist --out=report.json
```

Measured against the pinned real dataset at the defaults: Mediterranean 37%,
World 37%, Southeast Asia 54%, Sub-Saharan Africa 62% of the timeline
accelerated. Mediterranean and World come out identical because, at this
grid's resolution, the Mediterranean's cell range already contains every
change year on the map - see decision 0013's cost and
`docs/architecture.md`'s note on temporal coverage.

Reads: `<--dist>/changes.json` (default `dist`). Writes: `<--out>` if given.

## Bumping an upstream source

Every source is pinned in `sources.ts` by URL, upstream version and SHA-256.
Bumping one is a deliberate act, not something that happens as a side effect
of another change:

1. Edit the `url` and `upstreamVersion` in `sources.ts` for that source. Set
   `sha256` to `null` - the pipeline refuses to fetch an unpinned source
   without `--write-pins`, precisely so an edit like this can't accidentally
   ship unverified.
2. Run `pnpm fetch:sources -- --write-pins`. It downloads the new file,
   computes its checksum, and prints a `sources.ts` block to paste back in.
3. Paste the printed `sha256` back into `sources.ts` and commit.
4. Re-run `pnpm build`, re-run the acceptance tests, and - once Milestone 2
   exists - diff the change-year index, since a change in upstream sampling
   changes playback feel.
5. Regenerate fixtures deliberately: `pnpm extract-fixture` then
   `pnpm fixture:bless`, and review the diff in `fixtures/` and
   `fixtures/dist/` before committing. See `docs/data-sources.md` and
   `CONTRIBUTING.md`.

## When the build fails

### A duplicate `from_year`

```
N duplicate from_year rows across M polities, which breaks the version id.
Fix the data or add an alias.
```

Thrown by `deriveLineage` (`stages/lineage.ts`) when identity resolution
groups two rows for the same polity onto the same `fromYear` - the version id
(`${polityId}@${fromYear}`) would collide. Usually means two upstream rows
that should be one polity resolved to different names, or genuinely are the
same row duplicated upstream. Fix by adding an entry to
`packages/pipeline/aliases.json` (if it's an identity problem) or by
correcting the source data. See decision 0007 for what an alias entry looks
like and why it exists.

### An unwhitelisted overlap

```
N of M version overlaps are not whitelisted. Add each to
packages/pipeline/overlaps.json with a reason, or fix the data.
```

Thrown by the same stage when one polity's versions overlap in time
(`fromYear <= prev.toYear`) and the pair isn't listed in
`packages/pipeline/overlaps.json`. Every entry in that file needs a `reason`
explaining why the overlap is real rather than a data error - add one if the
overlap is genuine (two atlas sources disagreeing on a transition year, say),
or fix the upstream row if it isn't.

Both checks fail the build rather than warning, per `docs/standards.md`: a
warning in a pipeline nobody watches is the same as no check at all.
