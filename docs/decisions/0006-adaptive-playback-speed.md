# 0006 — Speed is the only control, and it adapts

**Status:** accepted; D not yet tuned against real data

## Context

Crossfade needs change events to have anything to animate. Sparse regions and
sparse centuries would otherwise play as long stretches of nothing punctuated by
a jarring pop.

The original plan was to measure the change density crossfade requires. The
better answer inverts it: rather than demanding the data be dense enough, let
time move at whatever rate keeps the map alive. Density becomes an input, not a
constraint.

## Decision

**Fade is derived from speed, never configured:**

```
fadeYears = clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)
```

Constant wall-clock fade keeps the feel identical across speeds. The clamp
exists because pure proportionality breaks at the top end, where the window
grows until three states of one polity overlap.

**Speed adapts to the gap ahead:**

```
speed = max(userSpeed, (nextVisibleChange - currentYear) / D)
```

`D` is the dead-time ceiling: the longest stretch of nothing the viewer will sit
through. Starting estimate 5–10 seconds; default 7.

The user's slider is a **floor**, not a target. It sets reading speed for when
things are happening. The system only ever accelerates through emptiness, never
drags below what was asked for.

Playback must **decelerate into an event**, easing back to reading speed before
arrival. Arriving at a change still travelling fast turns the crossfade into a
flicker.

`nextVisibleChange` is scoped to the **current viewport**. A border shifting
outside the visible area must not hold playback back.

## Consequences

- Zoom is promoted from optional to load-bearing, since speed depends on
  viewport. Multiple simplification levels follow from that.
- The change-year index must support "next change after year T within bbox B".
  Trivial in memory; a real index requirement if the data is ever tiled.
- Acceleration is signalled only by the year readout racing. Considered and
  rejected: an explicit skip marker, and distinguishing stable centuries from
  uncovered ones. Both remain available later — a version spanning 200 years is
  a positive assertion of stability, whereas no covering row is absence, so the
  data can tell them apart whenever we want it to.
- New metric to watch: **what fraction of the timeline gets accelerated.** At
  20% this is a map that occasionally skips. At 80% it is a fast-forward button
  with pauses, which is a different product. `scripts/histogram.mjs` reports it
  per region via `--speed` and `--deadtime`.
