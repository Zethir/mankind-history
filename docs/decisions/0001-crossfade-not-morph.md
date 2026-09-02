# 0001 — Crossfade, not geometry morphing

**Status:** accepted, validated on real data

## Context

Territorial history is discontinuous. A conquest is a step function. Making
borders appear to change smoothly requires either inventing intermediate
geometry or accepting hard cuts and softening them some other way.

## Decision

Crossfade. Each polity version ramps its opacity in over a fade window, holds,
and dissolves out. No geometry is interpolated.

Fade-out happens *after* the version's `to` year, not before it. The polity
genuinely existed up to `to`, so the dissolve is an admitted transition artifact
rather than a claim that it was already receding.

## Alternatives rejected

- **Geometry morphing.** Invents borders that never existed, which contradicts
  the project's core commitment. Independently, it breaks on multipolygons and
  topology changes, which describes most of this dataset.
- **Hard cut.** Legible, but reads as a slideshow.
- **Staggered cut** (per-polity jitter, no blending). Cheap and better than
  expected, but crossfade won on feel.

## Consequences

Two versions of the same polity are on screen simultaneously during a fade, so
draw order and per-version alpha both matter. Fade width must stay well below
median version duration or three states overlap at once. See 0006.
