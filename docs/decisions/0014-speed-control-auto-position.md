# 0014 - The speed control has an Auto position

**Status:** accepted; constants provisional until the Milestone 1 feel session

This amends decision 0006.

## Context

0006 made the user's speed a **floor**: "The system only ever accelerates
through emptiness, never drags below what was asked for." The project owner's
position is that this is the wrong bargain. A speed someone deliberately
selects is a request, not a minimum, and the map does not get to overrule it.

Separately, two of 0006's formulas do not survive the real data. Measured on
the pinned build's 13,380 versions, its fade rule
`clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)` is ill-defined:
the median version duration is 7 years, putting the upper bound at 1.17, below
the lower bound of 1.5. No value satisfies the clamp.

Its approach - a dead-time ceiling `D`, with a deceleration into the event -
was first written as two phases: a fast stretch sized to finish in
`D - DECEL_SECONDS`, then a fixed deceleration window. It sets the speed to
cover the remaining distance in a fixed time but recomputes every frame as
that distance shrinks, so it decays exponentially and never finishes on
schedule. Simulated at 120 Hz with `D = 7` and `DECEL_SECONDS = 1.5`, it takes
**20.72 s** to cross this dataset's largest gap of 300 years - roughly three
times the ceiling it was sized against - and 10.75 s to cross 50.

## Decision

**The control gains an Auto position, and Auto is the default.** In Auto,
0006's adaptive behaviour applies in full. Selecting a numeric speed leaves
Auto, and that speed is then honoured exactly and never exceeded. 0006's
"speed is the only control" stays literally true: one control, with a detent.

**Fade caps on extent, not duration:**
`fadeYears = min(FADE_SECONDS * speed, extent / 2)`, where
`extent = toYear - fromYear + 1`. It has to be extent, because 1,190 versions
(8.9%) have `toYear === fromYear`; a duration-based cap fades those over zero
years, a hard cut on a tenth of the dataset, which is the thing decision 0001
exists to prevent.

**One constant governs the approach:**
`speed = max(BASE_SPEED, remaining / APPROACH_SECONDS)`. The target falls
continuously as the event nears and equals `BASE_SPEED` for the last
`BASE_SPEED * APPROACH_SECONDS` years, so arriving at reading speed is true by
construction rather than by tuning. At `APPROACH_SECONDS = 1.5`, simulated the
same way, gaps close in 1.26 s at the median of 5 years, 2.88 s at the p90 of
14, 4.88 s at 50 and 7.58 s at the 300-year maximum - against the two-phase
design's 20.72 s.

## Consequences

- `D` stops being a constant that is set and becomes one that falls out. Dead
  time is `APPROACH_SECONDS * (1 + ln(G / (BASE_SPEED * APPROACH_SECONDS)))`,
  logarithmic in gap size, so `APPROACH_SECONDS` is a far less twitchy dial
  than a hard ceiling. 7.58 s lands inside Phase 0's estimated range of 5-10
  seconds without anyone choosing it.
- Auto is the default, so most viewers see 0006's behaviour unchanged. What
  changed is only what a deliberate speed selection means. Manual playback can
  now sit through a long empty stretch at 1 year/second, which is the point;
  0006's metric - what fraction of the timeline gets accelerated - now
  describes Auto only.
- Every constant here is provisional. None has yet been judged by a human
  watching the map, which is what the Milestone 1 feel session is for.
