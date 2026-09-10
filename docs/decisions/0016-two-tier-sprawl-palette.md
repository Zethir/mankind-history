# 0016 — Two tiers, separated by saturation: sprawling empires graph-coloured, everyone else hashed

**Status:** superseded by decision 0018 (this record was originally written
for a geographic-hue design that was rejected before shipping; that history
is summarised below, not kept in full -- see git history for the original
text if needed); the graph-colouring mechanism this record established is
further extended, not superseded, by the "Addendum" at the bottom of this
file (spatial proximity unioned into the same graph, this revision)

**Superseded, not discarded:** decision 0018 (the 1970s family palette)
keeps this record's central guarantee -- no two sprawling empires ever on
screen together share a colour, via the same graph-coloured co-visibility
mechanism -- but replaces the saturation-based two-tier split with hue
families, and drops the guarantee that a sprawling empire could never
coincide with a local polity's exact colour, which depended on that
saturation split. See 0018 for the argument and what it costs.

## Context

The Milestone 1 feel session was the first time a human watched the map run,
and the palette failed it. Colours read as meaningless: distant, unrelated
polities sharing a colour suggested one had invaded the other, or that a
colonial claim existed where the map shows none. Measured against the real
`dist/` (1,583 polities, 13,380 versions): the shipped 16-hue/2-lightness
palette produces exactly 32 colours, and the busiest year (195 polities on
screen, 2014) shares them roughly 6 polities per colour.

## The attempt this record originally accepted, and why it is rejected

The first fix tried was seeding hue from geography: rank every polity by its
earliest version's projected longitude and assign hue by that rank, instead of
a hash of the id, so a repeated colour would at least land on a geographic
neighbour instead of a random polity anywhere on Earth. Twelve hues (down from
sixteen) and three lightness bands (up from two), chosen because it measured a
better minimum CIE76 distance (12.9, against the shipped 8.3) and dropped the
same-colour longitude gap from a median of 220 degrees to 9.

That measurement was real but answered the wrong question. It compared
distances between *some* same-colour pair, not the pairs actually on screen
together, and on a map the only collisions that matter are the ones a viewer
can actually see at once. Measured properly, against real co-visibility: the
shipped hash palette had same-colour pairs overlapping in longitude on screen
15.8% of the time (41.4% within 20 degrees); the geographic-hue replacement
made this **worse**, not better -- 65.9% overlapping (94.8% within 20
degrees). Ranking every polity on Earth into 12 longitude bands packs each
band with whatever else happens to sit at that longitude, and that is exactly
the set of polities most likely to be visible together and therefore most in
need of telling apart. Two neighbours in Western Europe, both needing
distinct colours, are now far more likely to get adjacent hue bands than two
polities on opposite sides of the world were under the blind hash. The fix
traded a rare, distant, low-stakes false link for a common, adjacent,
high-stakes one -- worse on a map whose entire purpose is showing where
territory sits.

This is a documented dead end, not a footnote, because the instinct that
produces it is obvious: "colours collide, so seed them by geography" is the
first thing anyone re-reading this problem will think to try. The measurement
above is what stops that from happening twice.

This also revises this record's account of Phase 0's fallback. Phase 0 (see
`docs/phase-0-findings.md`) reasoned about a Mediterranean slice with a
handful of neighbours and recorded: "if neighbours read as the same colour,
use fewer hues with more lightness separation, not more hues." That is sound
advice for the problem Phase 0 was looking at -- distinguishing a modest
number of geographically adjacent polities from each other -- but it never
saw 195 simultaneous polities, and it was not reasoning about a colonial
empire whose *own* territory is scattered across the map. "More lightness
separation" does not help two pieces of the same colour land in different
hemispheres; it was never the axis that mattered for that failure mode.
CLAUDE.md requires arguing against a recorded decision rather than quietly
routing around it: the argument is that Phase 0's fallback answers a question
this problem does not ask, and the design below adds a dimension (a
per-polity graph-coloured reservation) that Phase 0 had no reason to
anticipate.

## What the data says the actual problem is

More colours does not help regardless of how they are assigned. The 32
shipped colours have a minimum CIE76 distance of 8.29 with zero confusable
pairs; pushing to 72 colours drops that to 6.0 with 22 pairs too close to
tell apart. Past roughly 40 colours, people stop being able to distinguish
them. "One distinct colour per polity" is unreachable at this density, full
stop -- no palette design fixes that.

What is reachable is distinguishing the polities whose colour repeating
*matters*. Most polities are small and short-lived: median longitude sprawl
across all versions is 6.1 degrees. But under this implementation's
bbox-based approximation of "sprawls" (see `lonSpanDegrees` in
`palette.ts`), 136 polities (out of 1,583) have at least one version whose
bounding box spans more than 45 degrees of longitude -- United States of
America (345.7 by this measure), Russian Empire (342.6), British Empire
(284.0), Spanish Empire (up to 248.3 across its several recorded names), and
so on. The historical brief that motivated this threshold independently
estimated 118 such polities by a different, more exact method (sweeping
actual vertex longitudes rather than approximating from a bounding box); the
gap between 118 and 136 is discussed under "Consequences" below. Either way,
these are precisely the polities a repeated colour actually misleads about:
Portugal's scattered holdings landing on France's colour reads as an invasion
or a claim the map never makes, in a way that two adjacent small polities
sharing a colour does not.

At most 29 of the 136 are ever on screen simultaneously (year 1905). Their
co-visibility graph -- two sprawling polities adjacent if any of their
versions' year intervals overlap -- has max degree 87, median 27. Greedy
colouring that graph, ordered by descending degree with ties on polity id,
needs 30 colours for zero conflicts.

That is not the whole story, though: it is co-visibility measured at a single
instant, and the renderer does not switch off a version the instant its claim
ends. `alphaFor` (`engine/fade.ts`) keeps drawing a fading-out version for
`fadeYears` past `toYear + 1`, so two empires whose claimed intervals merely
*abut* -- the ordinary shape of a succession, one polity's claim ending the
year another's begins -- are genuinely on screen together during that fade.
Widening the co-visibility test by a margin to account for this changes the
graph: at a 2-year margin, max degree 89, median 31, needing 31 colours; at
8 years, max degree 91, median 35, needing 34; at 16 years, max degree 96,
median 39, needing 38. **The 30-colour reservation this record originally
shipped with did not account for this and was wrong**: without the margin, 39
sprawling pairs within 2 years of each other resolved to the identical
colour on the real `dist/`, most of them exactly the successor-state pairs
this guarantee exists to protect -- `(British Empire)` fading into
`(Commonwealth of Nations)` one year apart, both `hsl(0 62% 74%)`, is the
canonical example. A colour repeating across the instant one empire visibly
becomes another reads as continuity, which is exactly the false assertion
decision 0001 exists to prevent, and a graph built only on instantaneous
overlap cannot see it.

## Decision

Two tiers, told apart by saturation, not by hue count.

**Tier 1 -- sprawling polities (136 of 1,583).** A polity qualifies if any of
its versions' bounding boxes spans more than 45 degrees of longitude,
approximated cheaply from the stored scaled-integer bbox (unproject both
corners at the box's own vertical midpoint) rather than sweeping every vertex
of every polygon -- this needs to run at load time in a browser. A
co-visibility graph over just the 136 candidates (not all 1,583 polities, and
not a sweep of the full 5,424-year range -- year-interval overlap between
versions is enough and is cheap at this size) is built with a
**`CO_VISIBILITY_MARGIN_YEARS` = 8** margin on both sides of every interval,
derived from the engine's own constants rather than picked by feel:
`FADE_SECONDS * max(SPEED_STEPS)` is 0.4 x 16 = 6.4 years, the longest fade
the fixed speed steps ever produce; `Math.ceil` takes that to 7, and one more
year of headroom covers Auto mode's adaptive speed transiently exceeding the
fixed steps while accelerating across a gap (a case that, by construction,
only happens where nothing on screen is changing anyway).

That margin-widened graph is greedy-coloured (descending degree, ties on
polity id) with **40 reserved colours**: 10 hues x 4 lightness bands
`[74, 50, 38, 26]`, 62% saturation. Minimum CIE76 distance across these 40,
computed against these exact constants: **15.98** -- statistically identical
to the 30-colour set's 16.03 tried first, and still above the shipped
palette's 8.29 and the rejected geographic-hue attempt's 12.9. 40 is
deliberately more than the 34 the margin-widened graph actually needs: the
extra headroom covers a re-blessed dataset with somewhat denser sprawl, or a
future increase to the margin (up to 16 years needs 38), without silently
wrapping. Verified against the real `dist/` at the 8-year margin: **zero
conflicts** among co-visible sprawling polities (including through fade
tails), using at most 34 of the 40 reserved colours. The guarantee this buys:
no two sprawling empires ever on screen together -- including while one is
crossfading into or out of existence -- share a colour.

**Overflow is observable, not silent.** `tier1Colour`'s modulo keeps
`colourFor` total (it must return a string for every id, including a
hypothetical future dataset whose graph needs more than 40 colours), but a
wraparound that lands two adjacent polities on the same final colour would
otherwise fail with nothing on screen to explain it. `buildPalette` now calls
`console.warn` once per build if the greedy colouring ever needed more
indices than are reserved, naming how many colours were needed against how
many were available. Not expected against real data -- confirmed silent
(no warning) at the shipped 8-year margin -- but a guarantee that fails
silently is worse than one that fails loudly.

The bbox approximation can overstate span for a version whose polygons were
cut at the antimeridian (decision 0012), because the cut pieces can sit near
both edges of the map and inflate the bounding box; that risk only adds a few
extra candidates to tier 1 (a wasted reservation slot), never breaks the
guarantee, and is bounded by the 40-colour reservation itself. The 136-vs-118
gap between this implementation and the motivating brief's estimate is
largely this same approximation finding real, if minor, sprawl the brief's
method did not count the same way -- for example the fixture alone contains
Kingdom of Italy, which clears 45 degrees only because of its Tianjin
concession (1901-1943) sitting 100+ degrees east of the mainland, and Nazi
Germany, whose occupied-territory extent at its widest version reaches 45.42
degrees from France to the occupied USSR -- both real history, not
measurement noise.

**Tier 2 -- everything else (roughly 1,447 of 1,583).** The existing
FNV-1a-hash-of-the-id approach, unchanged in mechanism, now at **12 hues x 3
lightness bands = 36 colours** (`[60, 48, 38]`, 26% saturation), up from an
intermediate 24-colour cut. Minimum CIE76 distance: **9.14** -- slightly below
tier 1's, still above the shipped palette's 8.29. This tier is not a footnote:
it carries most of what is actually on screen. At the busiest year (2014, 195
polities), 174 are tier 2. Measured density there: the 24-colour intermediate
cut gave a mean of 7.25 polities per colour (worst 13) -- *denser* than the
32-colour palette the owner watched and reported broken (mean 6.1, worst 12).
36 colours brings that back down to a mean of **4.83** (worst **10**),
better than the originally shipped palette on both figures. No graph
colouring here: a proximity-graph approach (colour by spatial nearness rather
than by pure hash) was measured to roughly halve local same-colour overlap
for this tier (16.1% down to 8.7%), but it needs a load-time computation over
all ~1,450 compact polities and their full version geometry -- not just 136
ids and their bounding boxes -- expensive enough to defer. **Deferred to
Milestone 2**, not dropped: the measurement above is what a future
implementer should expect to gain and what it will cost to get there.

The two tiers are told apart by saturation alone (62% vs 26%), deliberately,
so a sprawling empire can never read as just another local polity even where
hue coincides -- confirmed in the fixture, where Kingdom of Italy (tier 1,
hue 0) and Etruscans (tier 2, hue 0 as well) share a hue but are immediately
distinguishable by saturation.

This keeps `buildPalette(versions: VersionsArtifact): Palette` exactly the
shape the previous decision left it in: colour is still a function of the
*dataset*, not just the id, because tier-1 membership and the graph colouring
both depend on every polity's versions in the artifact.

## Consequences

- Colour remains a property of the id **and** the dataset it was built
  against, as the original text of this decision already noted: a
  re-blessed dataset can shift which polities qualify for tier 1 and how the
  graph colours them, even though decision 0007/0011 identity does not
  change.
- The 118-vs-136 discrepancy between the motivating brief's estimate and this
  implementation's measurement is real and unreconciled at the exact-count
  level; both methods agree on the four biggest sprawlers (USA, Russian
  Empire, British Empire, Spanish Empire) and on the busiest year (1905), so
  the qualitative picture is not in question, but a future implementer
  wanting byte-parity with the brief's own script would need to either adopt
  its exact-vertex method or accept this gap as the cost of a load-time-cheap
  approximation.
- 29 sprawling polities sit in the 40-50 degree band, close enough to the
  45-degree threshold that a re-blessed dataset could plausibly push the
  count, and the graph's colour requirement, past today's figures -- this is
  exactly why the 40-colour reservation carries headroom past the 34 today's
  8-year-margin graph needs, and why overflow is now a loud warning instead
  of a silent wraparound.
- A polity with no resolvable bbox for any version (should not happen; every
  version in a well-formed artifact carries one) is simply never a tier-1
  candidate and falls through to tier 2 -- there is no separate fallback path
  to maintain, unlike the anchor-dependent fallback the geographic-hue
  version needed.
- Tier 2's local collisions are unresolved, only bounded to be visually
  distinct in kind (muted) from tier 1's guarantee (empires only clash with
  other empires never, with local polities never) -- and, as of this
  revision, no longer denser than the palette the owner already rejected.
  Milestone 2 has a measured, costed option on the table if 36 colours still
  is not enough.
- The golden test vector in `render.test.ts` is regenerated again, this time
  also serving as a real (if small) demonstration of the guarantee: two of
  the fixture's three tier-1 polities, Kingdom of Italy and Nazi Germany, are
  genuinely co-visible (1936-1943) and resolve to different colours.
- This has not been judged by a human watching the map. Neither the original
  hash palette nor the geographic-hue attempt survived that judgement (the
  former was watched and reported broken; the latter was rejected by
  measurement before anyone watched it run), so this is the second
  candidate to reach that judgement, not the first.

## Addendum: spatial proximity unioned into the graph (this revision)

This record's central guarantee -- graph-colour the polities whose repeated
colour would mislead, so none of them share a colour with a co-visible peer
-- survived decisions 0018 and 0019 unchanged in mechanism, restricted to
"sprawling polities and aggregates," on the theory that scattered colonial
empires were the only repeated colours that actually misled a viewer. The
owner's verdict on the shipped 1970s palette, after watching it run, proved
that theory incomplete. Verbatim: *"I think we should not have the same
color on different polities that are touching or close, I think it's
disturbing."* An ordinary pair of adjacent, compact polities sharing a
colour by hash coincidence is exactly as misleading on screen as two
colonial empires sharing one -- it reads as one having annexed the other, or
as a border that does not exist -- and the co-visibility graph never had any
notion of "touching" to catch it, because it only ever knew about time.

**Measured, motivating the fix:** sampling 120 years across the real dist/'s
full range and treating bounding-box overlap in both axes as "neighbouring":
6,648 unique neighbouring polity pairs, of which 155 (2.33%) shared a drawn
colour. Greedy-colouring the same graph with a second kind of edge unioned
in -- two *drawn identities* (`memberOf ?? polityId`, so a member takes its
aggregate's slot and never competes separately; decision 0019's merged fill
would otherwise be contradicted by forcing a member and its own empire
apart) adjacent whenever their version bounding boxes overlap in both axes
during a year they are both live -- brings that to 0 (0.00%), using the
*same* 40 colours, with zero polities forced to collide.

**Verified against the real dist/ with the shipped implementation**, which
does not sample: `buildProximityGraph` (palette.ts) sweeps every year the
live version set can actually change (not a 120-year sample), so it cannot
miss a transient overlap the sampled measurement above might have. That
exhaustive sweep finds more neighbouring pairs than the sample did --
10,840, not 6,648, because it catches brief overlaps a 120-year sample skips
-- and still **0 conflicts**. The combined co-visibility/proximity graph has
1,348 nodes (154 co-visibility candidates, 1,314 proximity nodes, overlapping
at the aggregates present in both) and needs 35 of the 40 reserved colours
-- fewer than decision 0018's 36-for-co-visibility-alone, not a
contradiction: proximity mostly adds small, low-degree nodes that were
previously unconstrained (hash-assigned) and easy for greedy colouring to
slot into an existing gap, while the union only ever adds constraints, never
removes the sprawling-empire ones this record and decision 0018 measured.

**Both guarantees verified simultaneously, neither traded for the other.**
This record's original sprawling-empire co-visibility guarantee is unchanged
in mechanism (same `CO_VISIBILITY_MARGIN_YEARS`, same candidate selection)
and re-verified after the union: 2,911 sprawling co-visible pairs, **0**
conflicts. The new neighbouring guarantee: 10,840 neighbouring pairs, **0**
conflicts. `warnOnOverflow` (unchanged in mechanism, now checking the union)
fired zero times against the real dist/; if unioning proximity in ever
pushes the real graph's requirement past 40, that is the mechanism this
record already built for making that loud rather than silent -- see
"Overflow is observable, not silent" above.

**Expanding the palette was measured and rejected, not overlooked.** This
record's own "What the data says the actual problem is" section already
established that colour count does not fix a density problem: 40 colours
give a true all-pairs minimum CIE76 deltaE of 10.46; pushing to 72 collapses
that to 6.0 with 22 confusable pairs, because past roughly 40 colours people
stop being able to tell colours apart regardless of how they are assigned.
(This paragraph originally reported 11.9 here, with zero confusable pairs
claimed at 40 -- that number came from a selection script whose candidate
pool excluded same-shade cross-family pairs by mistake, which is exactly
what let a near-duplicate pair ship undetected: {hue: 40, saturation: 55%}
against {hue: 45, saturation: 50%} measures deltaE 3.33 at matching shades,
close enough to put two real polities in visually identical colour. See the
corrected comment on `FAMILIES` in palette.ts.) That finding holds exactly
as much for "touching neighbours" as it did for the original
sprawling-empire failure mode. A future reader tempted to fix a
neighbouring-colour complaint by growing `FAMILIES` should re-read this
paragraph first: the fix is spending the *existing* 40 colours against a
graph that knows about space, not manufacturing more colours nobody could
tell apart anyway. (Also stated as a code comment on `FAMILIES` in
palette.ts, specifically to head this off.)

**Performance.** A naive sweep testing every pair of live versions in every
one of the dataset's 5,424 years would be far too slow to run at page load.
`buildProximityGraph` instead sweeps only the "breakpoints" where the live
version set can change (every version's `fromYear` and `toYear + 1`,
deduplicated -- 509 against the real dist/'s 13,380 versions, not thousands),
and within each breakpoint segment sorts the live set by `minX` and prunes
with an eviction sweep before ever testing a pair's y-overlap. Measured
against the real dist/: `buildProximityGraph` itself runs in about 30ms, and
the full `buildPalette` call (including the unchanged co-visibility
construction and greedy-colouring the ~1,350-node union) in roughly 40-90ms
depending on JIT warmth across repeated measurements -- comfortably under
the rough 150ms budget this was measured against. No sampling was needed in
the shipped implementation, only in the motivating measurement above: an
exact sweep turned out to be fast enough that there was no need to trade
completeness for speed.

**Bounding-box overlap is a loose, deliberately conservative proxy for true
adjacency.** It reports two territories as neighbours whenever their
*rectangles* touch, even where the actual coastlines or borders inside those
rectangles do not (a near-miss on the diagonal, two coastlines facing each
other across open water) -- which only ever adds a colour-distinctness
constraint that was not strictly necessary, never removes one that was. A
conflict-free colouring built against it is therefore conservative, not
optimistic. Do not replace it with a tighter or "smarter" test (bbox
centres, a distance threshold, true polygon adjacency) on the theory that it
would be more accurate: a looser test could let a real touching pair through
uncaught, which is the exact defect this mechanism exists to close, while
the current test's only failure mode is a wasted colour-distinctness
constraint on a pair that never really touches.

**Consequences, in addition to the ones already recorded above:**

- The proximity graph considers *every* polity in the artifact, not just the
  ~150 sprawling/aggregate candidates -- most on-screen neighbouring
  collisions are between two perfectly ordinary, compact, adjacent polities,
  not empires, so restricting the new graph to the old candidate population
  would have missed the complaint entirely.
- The golden colour vector in `render.test.ts` moved again: several of the
  fixture's ancient-Mediterranean polities (Etruscans, Ostrogothic Kingdom,
  Papal States, Roman Kingdom, Vandal Kingdom, Visigoths, Western Roman
  Empire) now enter the graph-coloured population because each has a real
  proximity edge to something (Papal States to Kingdom of Italy -- they
  genuinely overlap, 1861-1870, in Rome; Ostrogothic Kingdom to Eastern Roman
  Empire -- Justinian's reconquest of Ostrogothic Italy is exactly this
  pair). A script checking every pair of the fixture's twelve polities for
  genuine time-and-bbox adjacency against the new golden vector found zero
  same-colour pairs that are also adjacent.
- This still has not been judged by a human watching the map with real
  neighbouring polities telling apart or not -- the 2.33%-to-0% figure is a
  measurement of colour assignment, not of what the map looks like once
  rendered at typical zoom, where a shared outline seam (drawn regardless of
  fill colour) already does some of the "these are different polities" work
  the fill colour is not solely responsible for.
