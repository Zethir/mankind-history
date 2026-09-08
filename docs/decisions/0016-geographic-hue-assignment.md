# 0016 — Hue is seeded from geography, not the polity id's hash

**Status:** accepted

## Context

The Milestone 1 feel session was the first time a human watched the map run,
and the palette failed it. Colours read as meaningless: distant, unrelated
polities sharing a colour suggested one had invaded the other, or that a
colonial claim existed where the map shows none.

Measured against the real `dist/` (1,583 polities, 13,380 versions): the
shipped 16-hue/2-lightness palette produces exactly 32 colours. The busiest
year, 2014, has 195 polities on screen sharing those 32 colours -- about 6 per
colour, confirmed by re-running the hash formula against the pinned build.
Because hue comes from a hash of the id, a repeat lands anywhere on Earth:
same-colour polities sat a median 220 degrees of longitude apart, worst 273 --
almost always the opposite side of the world, which is exactly the reported
symptom.

The obvious fix, more colours, is wrong. The 32 shipped colours already have a
minimum CIE76 distance of 8.3 with zero confusable pairs; pushing to 72 colours
drops that to 6.0 with 22 pairs too close to tell apart. Past roughly 40
colours, humans stop being able to distinguish them regardless of the
distance metric. "One distinct colour per polity" is unreachable at this
density -- Phase 0 said as much and named the fallback: "if neighbours read as
the same colour, use fewer hues with more lightness separation, not more
hues" (`docs/phase-0-findings.md`).

## Decision

Twelve hues (down from 16) and three lightness bands (up from 2) -- following
Phase 0's own fallback of fewer hues with more lightness separation, not more
hues, even though the resulting 36 colours is close to, not below, the
shipped 32. Hue is no longer a hash of the id -- it is assigned by each
polity's rank when all
polities are sorted by longitude (approximated as the projected anchor-x of
their earliest version's pole of inaccessibility). Lightness stays
hash-derived, so polities ranked next to each other still separate.

This makes `buildPalette(versions: VersionsArtifact): Palette` a function of
the *dataset*, not just the id: `colourFor` is no longer a standalone export.
Measured on the same fixture data, this drops the same-colour longitude
spread from a median of 220 degrees to 9 (worst 144), and the 12x3 combination
(`SATURATION = 55`, `LIGHTNESS = [72, 56, 40]`) measured a minimum CIE76
distance of 12.9 -- the best of everything tried, against the shipped 8.3.

## Consequences

- Colour is a property of the id **and** the dataset it was built against. A
  re-blessed dataset -- a new Cliopatria release, a fixture rebless -- can
  shift a polity's rank and therefore its hue, even though decision 0007/0011
  identity did not change. This is a real cost: colour stability across
  releases is now weaker than it was, traded for colour meaning within one
  release.
- A polity with no resolvable anchor (should not happen; verified zero such
  cases against the real `dist/`) falls back to a hash-derived hue with no
  geographic meaning, so it does not break the build, only its own locality.
- The golden test vector in `render.test.ts` is regenerated, and any future
  constant tweak (SATURATION, LIGHTNESS, HUES) will again show up there as a
  full-object diff rather than passing silently.
- This has not been judged by a human watching the map. Only the previous
  palette has been, and it was reported broken.
