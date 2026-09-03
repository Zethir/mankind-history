# Contributing

## Setup

```bash
nvm use          # Node 22, pinned in .nvmrc
pnpm install
pnpm fetch:sources  # downloads and checksum-verifies the pinned sources, ~46 MB (165 MB unpacked), once
```

`pnpm fetch:sources` is only needed for a full build. Tests run against the
committed fixture in `fixtures/` and need no download.

## Scripts

| Script | Does |
|---|---|
| `pnpm lint` | Biome check, errors on warnings. |
| `pnpm format` | Biome check --write. |
| `pnpm typecheck` | `tsc` over `packages/model` and `packages/pipeline`. |
| `pnpm test` | Vitest, the fixture-based fast lane. |
| `pnpm fetch:sources` | Download and checksum-verify the pinned sources into `data/`. |
| `pnpm build` | Run the pipeline against `data/sources`, write `dist/`. |
| `pnpm extract-fixture` | Regenerate `fixtures/` from the fetched full dataset. |
| `pnpm fixture:bless` | Rebuild `fixtures/dist/`, the golden artifacts the tests compare against. |

## Tests are the spec

Every acceptance criterion in a phase spec (`docs/phase-1-importer.md` for
Phase 1) is a test, named after the criterion it enforces. Adding a criterion
to the spec means adding a test for it - "the importer works" is not a
criterion, a runnable check is.

## Determinism rules you must not break

Byte-identical output on identical input, for the pinned toolchain, is an
acceptance criterion (decision 0010). Concretely:

- No wall-clock timestamps anywhere in `dist/`. Provenance is upstream
  versions and checksums, not the time of the run.
- All artifact output goes through `writeArtifact`
  (`packages/model/src/artifact.ts`), never a raw `writeFileSync` of JSON.
- Sorts are explicit wherever order isn't otherwise guaranteed - do not rely
  on object key insertion order or `Array.prototype.sort`'s behaviour on
  ties without a tie-breaker.
- Coordinates are scaled integers (`Math.round(projected * scale)`), never
  raw floats, so no float-formatting decision reaches the output.
- Validation failures throw and fail the build. Do not warn and continue - a
  warning in a pipeline nobody watches is the same as no check at all.

## When to write a decision record

Anything that constrains future work, or that someone will later ask "why on
earth" about. A decision record goes in `docs/decisions/`, numbered, roughly
15 lines: context, decision, consequences. Written when the decision is
made, not reconstructed afterward.

## Blessing fixtures

`pnpm fixture:bless` rebuilds `fixtures/dist/`, the golden output the
determinism and regression tests compare a fresh build against. Run it
whenever a change to the pipeline is meant to change the output - after
extracting a new fixture slice, or after an intentional change to a stage.

An unreviewed re-bless defeats the regression net. If the diff after
`fixture:bless` isn't exactly the change you meant to make, that's the test
doing its job - don't bless it away without understanding why it moved.

## Deliberately deferred

`CODE_OF_CONDUCT.md`, `SECURITY.md`, issue and PR templates, `CHANGELOG.md`.
These arrive when there are contributors and releases to need them, not
before.
