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
