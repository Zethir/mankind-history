# Standards

Small project, small rules. These exist so decisions do not get relitigated, not
to add ceremony.

## Code

- TypeScript everywhere. `strict: true`.
- ESM only. Node 22+. pnpm, workspaces (0009).
- Biome for lint and format. One config, checked in, no per-editor overrides.
- Vitest. Every acceptance criterion in a phase spec is a test, named after the
  criterion it enforces.

## Build pipeline

- Scripts run from the repo root and take explicit `--input` / `--out` paths.
  No implicit working-directory magic.
- Builds are deterministic. Same inputs, byte-identical outputs. This is what
  makes diffs meaningful when an upstream dataset bumps.
- Validation failures fail the build. Do not warn and continue: a warning in a
  pipeline nobody watches is the same as no check at all.
- `data/` is gitignored. Nothing downloaded or generated is committed.

## Data honesty

The project's one non-negotiable, stated once so it can be pointed at:

> Never assert something the data cannot support.

Concretely: no interpolated geometry, no clipping that creates a border, no
fabricated confidence values, no flash on unattributable growth. Gaps render as
gaps.

Note the distinction. Being honest about gaps is the bar. Having no gaps is not.
A visible gap is an invitation to contribute; a seamless-looking map that quietly
guessed is not.

## Documentation

- Architectural decisions go in `docs/decisions/`, numbered, roughly 15 lines:
  context, decision, consequences. Written when the decision is made, not after.
- Phase specs end with runnable acceptance criteria, not descriptions of intent.
- `CLAUDE.md` stays short. It loads every session; a long one dilutes itself.

## Attribution

Cliopatria is CC-BY. Attribution ships in the build manifest and in the UI, not
just in a README. Every source added to `docs/data-sources.md` records its
licence at the same time it is added.
