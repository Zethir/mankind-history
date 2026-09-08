# 0016 — Two tiers, separated by saturation: sprawling empires graph-coloured, everyone else hashed

**Status:** accepted (supersedes this record's original text, kept below)

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
shipped colours have a minimum CIE76 distance of 8.3 with zero confusable
pairs; pushing to 72 colours drops that to 6.0 with 22 pairs too close to
tell apart. Past roughly 40 colours, people stop being able to distinguish
them. "One distinct colour per polity" is unreachable at this density, full
stop -- no palette design fixes that.

What is reachable is distinguishing the polities whose colour repeating
*matters*. Most polities are small and short-lived: median longitude sprawl
across all versions is 6.1 degrees. But 118 polities (out of 1,583) have at
least one version whose bounding box spans more than 45 degrees of
longitude -- USA (312), British Empire (283), Russian Empire (266), Spanish
Empire (239), and so on. These are precisely the ones a repeated colour
actually misleads about: Portugal's scattered holdings landing on France's
colour reads as an invasion or a claim the map never makes, in a way that two
adjacent small polities sharing a colour does not.

At most 26 of those 118 are ever on screen simultaneously (year 1905), median
4.1. Their co-visibility graph (two sprawling polities adjacent if any of
their versions overlap in years) has max degree 83, median 25. Greedy
colouring that graph, ordered by descending degree with ties on polity id: 26
reserved colours leaves one conflict; 30, 34 and 40 all leave zero. 30 is the
smallest of the sizes tested that actually works.

## Decision

Two tiers, told apart by saturation, not by hue count.

**Tier 1 -- sprawling polities (118 of 1,583).** A polity qualifies if any of
its versions' bounding boxes spans more than 45 degrees of longitude,
approximated cheaply from the stored scaled-integer bbox (unproject both
corners at the box's own vertical midpoint) rather than sweeping every vertex
of every polygon -- this needs to run at load time in a browser. A
co-visibility graph over just the 118 candidates (not all 1,583 polities, and
not a sweep of the full 5,424-year range -- year-interval overlap between
versions is enough and is cheap at this size) is greedy-coloured with 30
reserved colours: 10 hues x 3 lightness bands, 62% saturation, lightness
[74, 53, 32]. Minimum CIE76 distance across these 30, computed against these
exact constants: **16.0** -- above the shipped palette's 8.3 and above the
rejected geographic-hue attempt's 12.9. Verified against the real `dist/`:
136 polities qualify under this implementation's threshold (some real
history is stranger than the 118-polity estimate assumed -- see below), 29
simultaneously visible at the busiest point (also year 1905), and greedy
colouring produces **zero conflicts** among co-visible sprawling polities,
using all 30 reserved colours. The guarantee this buys: no two
simultaneously-visible sprawling empires ever share a colour. Portugal's
scattered territories read as one thing and can never be confused with
France's.

The 136-vs-118 gap is the bbox approximation finding real, if minor, sprawl
the original estimate's method did not count the same way -- for example the
fixture alone contains Kingdom of Italy, which clears 45 degrees only because
of its Tianjin concession (1901-1943) sitting 100+ degrees east of the
mainland, and Nazi Germany, whose occupied-territory extent at its widest
version reaches about 53 degrees from France to the occupied USSR. Both are
real history, not measurement noise, and both are exactly the kind of
"scattered piece that must not be confused with something else" this tier
exists to protect. The approximation can also overstate span for a version
whose polygons were cut at the antimeridian (decision 0012), because the cut
pieces can sit near both edges of the map and inflate the bounding box; that
risk only adds a few extra candidates to tier 1 (a wasted reservation slot),
never breaks the guarantee, and is bounded by the 30-colour reservation
itself.

**Tier 2 -- everything else (roughly 1,465 of 1,583).** The existing
FNV-1a-hash-of-the-id approach, unchanged in mechanism, at 12 hues x 2
lightness bands, 26% saturation, lightness [58, 42]. Minimum CIE76 distance:
**9.9**, also above the shipped 8.3. No graph colouring here: a
proximity-graph approach (colour by spatial nearness rather than by pure
hash) was measured to roughly halve local same-colour overlap for this tier
(16.1% down to 8.7%), but it needs a load-time computation over all ~1,465
compact polities and their full version geometry -- not just 118 ids and
their bounding boxes -- expensive enough to defer. **Deferred to Milestone
2**, not dropped: the measurement above is what a future implementer should
expect to gain and what it will cost to get there.

The two tiers are told apart by saturation alone (62% vs 26%), deliberately,
so a sprawling empire can never read as just another local polity even where
hue coincides -- confirmed in the fixture, where Kingdom of Italy (tier 1,
hue 0) and Etruscans (tier 2, hue 0 as well) share a hue but are immediately
distinguishable by saturation.

This keeps `buildPalette(versions: VersionsArtifact): Palette` exactly the
shape the previous decision left it in colour is still a function of the
*dataset*, not just the id, because tier-1 membership and the graph colouring
both depend on every polity's versions in the artifact.

## Consequences

- Colour remains a property of the id **and** the dataset it was built
  against, as the original text of this decision already noted: a
  re-blessed dataset can shift which polities qualify for tier 1 and how the
  graph colours them, even though decision 0007/0011 identity does not
  change.
- A polity with no resolvable bbox for any version (should not happen; every
  version in a well-formed artifact carries one) is simply never a tier-1
  candidate and falls through to tier 2 -- there is no separate fallback path
  to maintain, unlike the anchor-dependent fallback the geographic-hue
  version needed.
- Tier 2's local collisions are unresolved, only bounded to be visually
  distinct in kind (muted) from tier 1's guarantee (empires only clash with
  other empires never, with local polities never). Milestone 2 has a
  measured, costed option on the table if that turns out not to be enough.
- The golden test vector in `render.test.ts` is regenerated again, this time
  also serving as a real (if small) demonstration of the guarantee: two of
  the fixture's three tier-1 polities, Kingdom of Italy and Nazi Germany, are
  genuinely co-visible (1936-1943) and resolve to different colours.
- This has not been judged by a human watching the map. Neither the original
  hash palette nor the geographic-hue attempt survived that judgement (the
  former was watched and reported broken; the latter was rejected by
  measurement before anyone watched it run), so this is the second
  candidate to reach that judgement, not the first.
