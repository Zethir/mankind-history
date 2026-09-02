# 0004 — The expansion flash, and when it is suppressed

**Status:** accepted

**Read this one before changing flash behaviour. "Why doesn't this territory
flash" has a subtle answer and it is deliberate.**

## Context

Territories that grow brighten as they fade in; territories that shrink just
fade. Light carries the event, which is what makes the map feel alive.

The risk is that brightness reads as *conquest*. But a positive area delta in
Cliopatria can also mean the source atlas for that century was drawn at finer
resolution than the one before it. And because sampling is lumpy, a polity with
a 200-year gap between versions produces an enormous delta representing two
centuries of drift, not an event. Flashing that invents a dramatic moment the
data does not support — the same failure as morphing, better dressed.

## Decision

Flash strength scales with **relative** area change, so a small polity doubling
reads as strongly as an empire gaining a few percent. Full strength at +50%.

Suppressed entirely when:

- **First appearance.** Often the atlas beginning to cover a region rather than
  a polity coming into being.
- **Gap since the previous version exceeds 50 years.** Not attributable to a
  datable event.
- **Delta is zero or negative.** Contraction fades without a flash.

## Consequences

The flash goes quiet precisely where coverage is weakest. That is the intended
behaviour, not a bug, and it makes data quality legible without a separate
indicator.

Requires `prevArea`, `delta` and `gap` on every version. Cliopatria stores
versions independently with no link between them, so these are derived at build
time. See `docs/phase-1-importer.md`.
