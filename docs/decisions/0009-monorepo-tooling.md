# 0009 — pnpm workspaces now, Nx deferred

**Status:** accepted

## Context

The repository will hold at least a build pipeline and a viewer, and plausibly an
authoring tool later. Monorepo tooling ranges from plain workspaces through
Turborepo to Nx.

## Decision

**pnpm workspaces.** Strict `node_modules`, fast, good workspace support, no
meaningful downside.

**Not Nx, yet.** Its value is task-graph caching, affected-detection and
generators across many packages. At three packages, `pnpm -r` plus a few scripts
does the same work, and Nx is paid for in config surface and migration burden on
every major version. `nx init` works on an existing pnpm workspace, so adding it
later is cheap.

**Revisit when** there are four or more packages with a non-trivial dependency
graph, or when build times become annoying. If the pain is purely caching,
Turborepo gets there for roughly twenty lines of config and far less opinion.

## Layout

```
packages/
  model/      canonical types + artifact read/write contract
  pipeline/   depends on model
  viewer/     depends on model (types) and dist/ (data). Never on pipeline.
```

Splitting `model/` out is what makes the pipeline/viewer boundary
self-enforcing. The viewer needs types in order to read build artifacts, but it
must never reach into the pipeline to obtain them.

## Consequences

The one thing Nx would have bought early is
`@nx/enforce-module-boundaries`, which would enforce that boundary
mechanically rather than by discipline. On a solo project the shared `model`
package plus noticing in review is judged sufficient. If the viewer ever
accidentally imports pipeline code and it is not caught, that is the signal to
reconsider.
