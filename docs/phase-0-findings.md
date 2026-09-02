# Phase 0 findings

**Closed.** The spike's job was to decide what "time flowing smoothly" means,
concretely enough to design a schema against. It did that, and it changed the
question in the process.

## What was tested

Cliopatria POLITY rows, Mediterranean (lon −10→45, lat 25→50), 200 BCE–500 CE,
projected to Equal Earth, rendered on canvas 2D. Hard cut, crossfade and
staggered cut compared on the same data. Morph was skipped deliberately.

## Answers

**1. Which mode.** Crossfade. Smooth and easy to follow over long sittings.
Staggered cut was better than expected and is the fallback if crossfade ever
proves too heavy. See 0001.

**2. Speed and transition duration.** 4 years/second is the reading speed that
felt right. Fade should not be independently configurable; it derives from
speed. Speed is the only control. See 0006.

**3. The density threshold — dissolved, not answered.**

This was meant to be a number: how many change-years per century crossfade needs
before it stops feeling alive. Instead the question turned out to be badly
posed. Rather than requiring the data to be dense enough, playback speed adapts
to whatever density is there, accelerating through gaps to keep dead time under
a ceiling `D` of roughly 5–10 seconds.

Density stops being a constraint and becomes an input.

## What replaced it

`D`, the dead-time ceiling, is now the tunable constant. Starting value 7s.

And a new metric worth watching: **the fraction of the timeline that gets
accelerated.** At 20% this is a map that occasionally skips ahead. At 80% it is
a fast-forward button with occasional pauses, which is a materially different
product. `scripts/histogram.mjs` now reports it per region.

Run it across all four regions before Phase 2 UX work. It costs five minutes and
tells you whether adaptive speed is a garnish or the main mechanic.

## Also settled, beyond the original remit

Feel-testing pulled in decisions Phase 0 was not scoped for. All recorded:
Equal Earth with no map library (0002), land-and-sea basemap (0003), expansion
flash with attribution rules (0004), adaptive speed (0006).

Visual direction: deep map plate, warm retro chrome around it. Chalky pastels on
the plate, because the dark ground is what leaves headroom above the base tones
for the expansion flash to travel into. On a light ground the flash would have
to invert to a saturation shift, which is far harder to notice peripherally.

## Not validated

- The pastel palette against real data at full density. Sixteen hues at 34%
  saturation is a lot to keep distinct; the Mediterranean at its peak will test
  it. If neighbours read as the same colour, the fix is fewer hues with more
  lightness separation, not more hues.
- Adaptive speed itself. It was reasoned into existence after the spike, not
  felt. If the acceleration fraction comes back high, prototype it before
  committing to Phase 2.
- Anything outside the Mediterranean, which is the best-covered slice in the
  dataset and therefore the least representative.
