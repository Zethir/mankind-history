# Phase 2, Milestone 1 — implementation design

The viewer's vertical slice: the whole world at coarse detail, playing.

Phase 1 produced eight validated artifacts and nothing that draws them. This
milestone draws them, moves them through time, and ends with a URL the project
owner can watch. It is deliberately the *feel* milestone, not the architecture
milestone, because two things Phase 0 left unvalidated are load-bearing for
everything after it and both are cheapest to disprove now.

Read `docs/architecture.md` first. Decisions 0001, 0002, 0003, 0004 and 0006
govern almost everything here; this document says how they are implemented and,
in one case, where one of them is wrong.

## Scope

In:

- Whole world, coarse level only. No zoom, no pan.
- Land basemap from `land.0.json`, three ground tones (0003).
- Crossfade between versions (0001).
- The expansion flash, with all three suppression rules (0004).
- Autoplay with the speed control, adaptive in Auto (0006, as amended below).
- A scrubber over the full range, a year readout, play/pause.
- Attribution and the modern-coastline note, in the UI (`docs/standards.md`).
- Deployed to a public URL.

Out, and belonging to Milestone 2:

- Zoom, pan, and level switching between coarse/mid/full.
- Viewport-scoped `nextVisibleChange`. With no zoom the viewport is the world,
  so the world-wide change list is not an approximation here -- it is exactly
  correct, and it still exercises the measured 37% acceleration case.
- Replacing `PX_PER_UNIT` with real figures and retightening the no-new-gaps
  bound. M1 establishes the real viewport size; M2 spends it.
- Hover, labels, territory names, the detail panel. Phase 3.

## Measurements that shaped this design

Taken against the full pinned build (1,583 polities, 13,380 versions,
`dist/versions.0.json`), not against the fixture.

### Rendering is not a performance problem

| | active versions | on-screen coarse vertices |
|---|---|---|
| median year | 35 | 1,548 |
| p95 | 147 | 16,066 |
| most versions, year 2014 | 195 | 18,537 |
| most vertices, year 1919 | 90 | 19,729 |

The coarse artifact holds 2,400,206 vertices in total, but a year is a thin
slice of a 5,424-year span, so the worst frame ever drawn is under 20,000
vertices. Canvas 2D fills that comfortably.

The consequence is a design *subtraction*: no offscreen layer caching, no dirty
rectangles, no tiling, no retained scene graph. A full clear-and-redraw every
frame from prebuilt `Path2D`. These are the optimisations a renderer of this
kind usually grows, and they are ruled out here by measurement rather than
deferred by optimism. If profiling ever contradicts this, the measurement above
is the thing to re-take first.

The same reasoning applies to the active-set query: a linear scan of all 13,380
rows per frame is roughly 13,000 comparisons, which is nothing, and it behaves
identically under playback, scrubbing and jumping. No sweep, no cursor, no
incremental state to invalidate.

### Decision 0006's fade formula does not survive the real data

0006 specifies:

```
fadeYears = clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)
```

Measured median version duration is **7 years**. The upper bound is therefore
7/6 = 1.17, which is *below* the lower bound of 1.5. The clamp's bounds are
inverted and the expression is ill-defined.

This is not a near miss. Version durations are far shorter than 0006 assumed:

| duration | versions | share |
|---|---|---|
| 0 (a single year) | 1,190 | 8.9% |
| <= 1 | 2,209 | 16.5% |
| <= 2 | 3,247 | 24.3% |
| <= 5 | 6,045 | 45.2% |
| <= 10 | 8,975 | 67.1% |

p10 is 1 year, median 7, p90 44. A global fade width anywhere near 1.5 years is
longer than the entire life of a quarter of the dataset. 0006 was written during
Phase 0 against the Mediterranean slice, where coverage is densest and versions
longest, and it generalised from there.

**The amendment.** Fade width becomes per-version and self-limiting:

```
versionExtent = toYear - fromYear + 1
fadeYears     = min(FADE_SECONDS * speed, versionExtent / 2)
```

This keeps 0006's actual intent -- "constant wall-clock fade keeps the feel
identical across speeds" -- and drops only the global median, which was serving
0001's "fade width must stay well below median version duration". Capping at
half the version's own occupancy serves that constraint directly and
per-version, cannot invert, and needs no floor.

The cap is on **extent**, not on `toYear - fromYear`, and the difference is not
pedantic: 1,190 versions (8.9%) have `toYear == fromYear`. Their duration is
zero, so a duration-based cap would give them a fade width of zero -- a hard cut
on nearly a tenth of the dataset, which is the one thing 0001 exists to avoid.
Their extent is one year, so they get a half-year fade and read as a blink,
which is what the data actually asserts happened.

### The change index counts each transition twice

`changes.json` holds 937 distinct years across all cells. Those collapse to
**509** moments at which something actually changes: there are 508 distinct
`fromYear` values and 508 distinct `toYear` values, and for 507 of them the
`toYear + 1` is exactly the next version's `fromYear`. A version ending at Y
followed by one starting at Y+1 is one transition recorded as two years.

The engine collapses adjacent years into one event before using them. Without
that, playback decelerates into a change, arrives, and immediately decelerates
again one year later into the same event.

Gaps between the 509 collapsed moments: median 5 years, p90 14, max **300**. At
the 4 years/second reading speed Phase 0 settled on, the median gap is 1.25
seconds of nothing and the worst is 75 seconds. That worst case is precisely
what `D` exists to cap.

### Other figures the implementation depends on

- Year range: -3400 to 2024, span 5,424. **Every** year in that range has at
  least one active version -- there is no year that renders as an empty plate.
- Up to 195 versions begin in a single year (median 22), so a mass crossfade is
  a real case, not a hypothetical.
- 5,697 versions (42.6%) are flash-eligible under 0004's rules. The flash is a
  common path, not an edge case.
- M1's payload: `versions.0.json` (3.02 MB gzipped, **35.3 MB uncompressed**),
  `polities.json` (45 KB), `land.0.json` (31 KB).

## Decisions taken while brainstorming

1. **Milestone shape: feel-first vertical slice.** M1 is real code that is kept,
   scoped so that it answers the unvalidated questions. Same shape as Phase 1's
   milestone split.
2. **Engine / renderer split**, not a single `Viewer` class. The reason is
   testability: 0001, 0004 and 0006 are all invariants, and a DOM-free engine
   makes each one a named test rather than something checked by watching.
3. **Vanilla TypeScript with Vite.** No UI framework. The canvas does the work
   and M1's chrome is a handful of controls. The Phase 3 detail panel is what
   might later justify a framework; adopting one then costs a rewrite of a few
   hundred lines of chrome, because the render core is framework-agnostic
   either way.
4. **The speed control has an Auto position**, replacing 0006's floor
   semantics. See the new decision record below.
5. **The fade formula is amended** as derived above.
6. **No render caching**, as derived above.
7. **M1 ends deployed.** The feel session happens over a real network on a real
   device, and the data-hosting question is answered while the codebase is
   small rather than retrofitted in M3.

## The engine

Pure TypeScript. No DOM, no canvas, no `window`. This is the constraint that
makes the rest testable, and it is worth enforcing in review.

### `timeline.ts`

Built once from `versions.0.json`. Given a fractional year, returns the versions
that should be on screen and each one's alpha.

A version is visible over `[fromYear, toYear + 1 + fadeYears]`. Both fades sit
**inside or after** the claim, never before it. 0001 states the rule for the
fade-out -- the polity genuinely existed up to `toYear`, so a dissolve
beforehand would assert a recession the data does not claim -- and the same
argument applies in the other direction, so the fade-**in** begins at `fromYear`
rather than ramping up ahead of it.

This still produces a true crossfade. Version A's fade-out occupies
`[toYear_A + 1, toYear_A + 1 + fadeYears]`, and its successor's `fromYear` is
`toYear_A + 1`, so B's fade-in overlaps A's fade-out exactly. The difference is
that only **one** of the two is ever shown outside its own claim -- A, which
0001 explicitly admits as a transition artifact -- instead of both.

Alpha ramps 0 -> 1 over `[fromYear, fromYear + fadeYears]`, holds at 1 until
`toYear + 1`, then ramps 1 -> 0 over `[toYear + 1, toYear + 1 + fadeYears]`.
Because `fadeYears` is capped at half the extent, alpha always reaches 1.

Implemented as a linear scan over all rows, for the reasons measured above.

### `change-years.ts`

Exposes `nextChangeAfter(year): number | null`, over the years at which
something visibly changes: a version's fade-in begins at its `fromYear`, and a
version's fade-out begins at `toYear + 1`. The event set is therefore
`{fromYear} union {toYear + 1}` across all versions -- the 509 moments measured
above.

**M1 derives this from `versions.0.json` rows and does not load
`changes.json`.** The index cannot produce it: its cells store `fromYear` and
`toYear` values mixed together and indistinguishable, so `toYear + 1` cannot be
recovered from them. Deriving from rows is exact, needs no heuristic, and costs
one pass over data already in memory. The index exists for viewport scoping,
which M1 does not do -- with no zoom, the whole world is the viewport.

**A defect this exposes, for M2 to fix.** `changes.json` stores `toYear` where
the visible event is at `toYear + 1`. When M2 introduces viewport-scoped
queries it cannot paper over this per-cell, because adding 1 to every stored
year would also corrupt the `fromYear` entries. The fix belongs in the pipeline:
have `stages/change-index.ts` bucket `fromYear` and `toYear + 1` rather than
`fromYear` and `toYear`, then re-bless the golden fixture. Recording it here so
M2 finds it as a known task rather than as a rendering bug.

### `clock.ts`

The part 0006 governs, and the part most likely to change once the map is
watched.

```
manual:  speed = userSpeed                    exactly, at every tick

auto:    target = max(baseSpeed, (nextChange - currentYear) / APPROACH_SECONDS)
         applied = target <= applied
                     ? target                                   snap down
                     : applied + (target - applied) * (1 - e^(-dt / TAU))
```

One constant governs the approach. Speed is set so the remaining distance would
be covered in `APPROACH_SECONDS`, floored at reading speed, which means the
target falls continuously as the event nears and equals `baseSpeed` for the last
`baseSpeed * APPROACH_SECONDS` years. Arrival at reading speed is therefore true
**by construction**, not by tuning.

The asymmetry matters. Deceleration is applied immediately, which is not a jolt
because the target is already falling continuously; acceleration is smoothed,
because the target does jump upward the instant a change year is passed.

An earlier formulation used two phases -- a fast stretch sized to finish in
`D - DECEL_SECONDS`, then a fixed deceleration window -- and it is wrong. It
sets the speed to cover the remaining distance in a fixed time but recomputes
every frame as that distance shrinks, so it decays exponentially and never
finishes on schedule. Simulated at 120 Hz against real gap sizes:

| gap (years) | two-phase | this design | closed form |
|---|---|---|---|
| 5 (median) | 1.26 s | 1.26 s | 1.25 s |
| 14 (p90) | 3.51 s | 2.88 s | 2.77 s |
| 50 | 10.75 s | 4.88 s | 4.68 s |
| 100 | 14.77 s | 5.93 s | 5.72 s |
| 300 (max) | **20.72 s** | **7.58 s** | 7.37 s |

The two-phase design blows the dead-time ceiling by a factor of three at the
gaps that matter most. This one closes the dataset's largest gap in 7.58
seconds, against Phase 0's estimated range of 5-10 and its starting value of 7 --
so `D` is no longer a constant that is set, it is a property that falls out.
The closed form for a gap `G` is `APPROACH_SECONDS * (1 + ln(G / (baseSpeed *
APPROACH_SECONDS)))`; the simulation runs slightly above it because of the
upward smoothing when a gap is first entered.

Constants, all in one place and all provisional until the feel session:
`APPROACH_SECONDS = 1.5`, `TAU = 0.3` s, `FADE_SECONDS = 0.4`, base reading
speed 4 years/second (Phase 0). Note the dead-time growth is logarithmic in gap
size, so `APPROACH_SECONDS` is a far less twitchy dial than a hard ceiling
would be.

### `flash.ts`

Decision 0004, restated as a function. Strength is zero when `prevId` is null
(first appearance), when `gap > 50`, or when `delta <= 0`. Otherwise:

```
relativeDelta = delta / (area - delta)
strength      = clamp(relativeDelta / 0.5, 0, 1)
```

Full strength at +50% relative growth, so a small polity doubling reads as
strongly as an empire gaining a few percent. Note `prevArea` is not stored on
`Version`; it is exactly `area - delta`, both being build-time values.

The flash rides the fade-in envelope and decays to zero shortly after the
version reaches full opacity. It is a flash, not a tint.

### `frame.ts`

What the engine hands the renderer each tick, and the whole of their contract:

```ts
interface Frame {
  year: number;
  speed: number;
  mode: "auto" | "manual";
  draws: { versionId: string; alpha: number; flash: number }[];
}
```

Nothing else crosses the boundary. Because this is plain data, the engine's
entire behaviour can be snapshot-tested without a canvas.

## The renderer

### `transform.ts`

Scaled integers to screen pixels. Coarse coordinates are at `COORD_SCALE.coarse`
(1e5); the projected world is `2 * WORLD_HALF_WIDTH` = 5.4133 units wide and
`2 * WORLD_HALF_HEIGHT` = 2.6347 units tall. The transform fits the world to the
canvas preserving aspect, at `devicePixelRatio`.

M1 records the resulting pixels-per-projected-unit at a typical window size.
That is the real number `PX_PER_UNIT` was a guess at, and M2 spends it.

### `canvas.ts`

Clear, draw land, draw versions. One `Path2D` per version, built lazily on first
draw and cached in a `Map` -- bounded at 13,380 entries, so no eviction, and
time-to-first-frame does not pay for 2.4M vertices of path construction up
front.

Versions draw in **descending area order**, so a small polity is never buried
under an empire that merely sorts later.

### `palette.ts`

Colour is assigned **per polity, not per version**, as a deterministic function
of the polity id. A polity keeps its colour across every version it ever has.
This is not cosmetic: crossfading between two versions of the same polity while
its colour shifts would read as one entity being replaced by another, which is
exactly the false assertion 0001 exists to avoid.

Phase 0's starting palette is 16 hues at 34% saturation on a dark plate, chosen
so the flash has lightness headroom to travel into (0003, and Phase 0's visual
direction). Phase 0 explicitly did not validate it at real density and named the
fallback: if neighbours read as the same colour, use **fewer hues with more
lightness separation**, not more hues. Judging this is part of M1's exit
condition.

## Chrome

- **Year readout**, deliberately prominent. Per 0006 the racing year is the
  *only* signal that playback is accelerating; everything else was considered
  and rejected.
- **Play / pause.**
- **Speed control** with an Auto position at one end and discrete numeric
  settings beyond it.
- **Scrubber** over -3400 to 2024.
- **Attribution** for Cliopatria (CC-BY) and Natural Earth, in the interface.
  `docs/standards.md` requires this in the UI, not only the README.
- **The modern-coastline note**, stated once and not hidden (0003).

## Data loading and deployment

M1 fetches three artifacts -- `polities.json`, `versions.0.json` and
`land.0.json`, about 3.1 MB gzipped in total. `changes.json` is not fetched;
see `change-years.ts` above for why. The transfer is small but
`versions.0.json` is 35.3 MB uncompressed, so the `JSON.parse` is not free: the
app shows a real loading state rather than a blank canvas, and the loading path
is written assuming parse time is the dominant cost, not download time.

Artifacts are served as static files from the same origin as the app. No
database and no CDN decision -- `docs/architecture.md` argues why, and nothing
in M1 changes that argument.

Deployment is GitHub Pages via Actions. The workflow runs the existing pipeline
build, builds the viewer, and publishes both together, so the deployed map and
its data always come from one commit. `data/` is cached between runs so the
46 MB source download does not repeat on every deploy.

The viewer refuses to start on an unrecognised `schemaVersion` rather than
half-rendering.

## Layout

```
packages/viewer/
  index.html
  vite.config.ts
  package.json
  src/
    main.ts              wiring only
    engine/
      timeline.ts
      change-years.ts
      clock.ts
      fade.ts
      flash.ts
      constants.ts
      frame.ts           types
    render/
      canvas.ts
      transform.ts
      palette.ts
    ui/
      chrome.ts
  tests/
```

Imports types and constants from `packages/model`. Never from
`packages/pipeline`, per `docs/architecture.md`.

## Acceptance criteria

Every one of these is a test, named after the criterion, run by `pnpm test`
against `fixtures/dist` so the suite still needs no download.

The fixture's 47 versions were checked to cover every branch these criteria
exercise: 15 with `toYear == fromYear`, 12 first appearances (`prevId` null),
1 with `gap > 50`, 13 with a non-positive delta, and 21 flash-eligible. No
synthetic rows are needed to reach any suppression rule.

**Clock (0006, as amended)**

1. In manual mode the instantaneous speed equals the user's setting at every
   tick, for every setting tested. It is never exceeded.
2. In auto mode the speed is never below the base reading speed.
3. In auto mode the speed equals the base reading speed **exactly** at the tick
   a change year is reached, for every gap size tested. This is a construction
   property, not a tolerance.
4. In auto mode, simulating the crossing of a gap of G years takes no longer
   than `APPROACH_SECONDS * (1 + ln(G / (baseSpeed * APPROACH_SECONDS))) + 0.5`
   seconds, checked at G = 5, 14, 50, 100 and 300 -- the last being this
   dataset's largest gap. The simulation is the independent oracle here; the
   closed form is not what the implementation computes.
5. Playing the full timeline never moves the year backwards.

**Fade (0001, as amended)**

6. No version's fade width exceeds half its own extent, checked across every
   version in the fixture.
7. Fade-out begins strictly after `toYear`, never before.
8. Alpha is 0 outside the visible window, exactly 1 through the held middle, and
   monotonic across each ramp.

**Flash (0004)**

9. Strength is 0 when `prevId` is null.
10. Strength is 0 when `gap > 50`.
11. Strength is 0 when `delta <= 0`.
12. Strength reaches 1 at +50% relative area change and is monotonic in relative
    delta below that.

**Timeline**

13. For any queried year `y`, every version with `fromYear < y <= toYear + 1` is
    returned with alpha `> 0`, and every returned alpha lies in `(0, 1]`.
    Verified to hold with zero violations across both the fixture and the full
    build.

    This replaces an earlier formulation that cross-checked the active set
    against a brute-force filter. That would have been vacuous: the
    implementation *is* a linear scan, so brute force is not an independent
    oracle -- unlike the pipeline's `nextChangeBruteForce`, which checked a grid
    index against a genuinely different method. Milestone 2 shipped one vacuous
    test of exactly this shape before it was caught. Stating the criterion
    against the raw claim interval, which the fade logic never consults, keeps
    the oracle independent.

    Note the half-open interval. At `y == fromYear` a version is at the very
    start of its fade-in and therefore at alpha 0, which is correct and not an
    exclusion bug.

14. **Checked in the full-build workflow, not the test suite.** Sampled at
    mid-year, every year from -3400 to 2024 has at least one version at alpha
    `> 0` -- the map is never a blank plate. This cannot live in `pnpm test`,
    because the fixture is a deliberately sparse 47-version slice with 2,180
    uncovered years; it is a property of the real dataset, so it belongs beside
    the existing 8 MB budget check in `.github/workflows/full-build.yml`.

    Measured on the full build: 0 empty years sampled at mid-year, which is what
    playback actually renders. Sampled at exact integer years there is exactly
    one, -3400, because every version beginning in the dataset's first year is
    at alpha 0 at the instant it begins.

**Change index**

15. `nextChangeAfter(y)` returns the smallest event year strictly greater than
    `y`, and null past the last one. The event set is checked to equal
    `{fromYear} union {toYear + 1}` over the fixture's rows, computed
    independently of the implementation.

**Render, pure parts**

16. The world-to-screen transform round-trips a coordinate to within one pixel.
17. Palette assignment is stable: the same polity id yields the same colour
    across runs, and across every version of that polity.

**Contract**

18. The viewer refuses to start on an unrecognised `schemaVersion`.
19. Frame snapshots: the engine's `Frame` output at a fixed set of years matches
    committed expectations.

**Milestone exit condition, not a test**

20. Deployed to a public URL, serving app and data from one commit.
21. The project owner watches it and judges two things Phase 0 could not: does
    adaptive playback feel right, and does the 16-hue palette hold up at real
    density. Both are permitted to change the design; that is why this milestone
    is first.

## New decision records to author

**Amending 0006 — the speed control has an Auto position, and fade is
per-version.** Two changes, one record. 0006 makes the user's slider a floor and
keeps accelerating above it. The project owner's position is that a speed the
user has explicitly set should be honoured exactly. The resolution keeps 0006's
"speed is the only control" literally true: the control has an Auto position,
which is the default and where 0006's adaptive behaviour applies in full;
selecting any numeric value leaves Auto and that number is then never exceeded.
The record must also carry the fade formula correction and the measurements that
forced it, since a future reader will otherwise reasonably restore the median.

**No render caching, by measurement.** Records that layer caching, dirty
rectangles and tiling were considered and ruled out because the worst frame in
the dataset is under 20,000 vertices. Without the number written down this reads
as an omission rather than a decision, and someone will add caching
speculatively.

## Risks

**Adaptive playback may simply feel wrong.** This is the acknowledged one, and
the reason for the milestone order. Phase 0 flagged that adaptive speed "was
reasoned into existence after the spike, not felt", and instructed a prototype
if the acceleration fraction came back high. It came back 37% / 37% / 54% / 62%.
If it feels wrong, M1 is the cheapest possible place to find out, and the
engine/renderer split means the fix is contained in `clock.ts`.

**The palette may not survive real density.** Sixteen hues at 34% saturation,
never tested against the Mediterranean at peak with up to 195 simultaneous
polities. The fallback is recorded; the risk is that it costs a second pass.

**`D = 7` is untuned.** It is Phase 0's starting estimate against a range of
5-10 seconds. The 300-year maximum gap means the constant is genuinely
load-bearing, and it may need to differ per region -- which is the tabled
per-region default speed question from Milestone 2's notes, and stays tabled.

**35.3 MB of JSON parsed on the main thread** may produce a visible stall on a
slow device. If it does, the answer is a worker or a binary format, and both are
M2 or later -- not something to build pre-emptively against a stall nobody has
observed.

## Out of scope

- **Zoom, pan, level switching.** Milestone 2, along with viewport-scoped
  `nextVisibleChange` and the real `PX_PER_UNIT`.
- **Hover, labels, territory names, the in-app detail panel.** Phase 3. The
  artifact contract already carries `anchor` (pole of inaccessibility) for
  label placement, so nothing here blocks it.
- **A per-region default playback speed.** Tabled in Milestone 2's design and
  still tabled; it needs the feel session's answers first.
- **`RELATION` rows**, still dropped by the pipeline.
- **Mobile and touch.** M1 targets a desktop browser. Not a commitment against
  mobile, just not what the feel session needs.
