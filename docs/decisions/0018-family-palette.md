# 0018 — A 1970s family palette, superseding 0016's saturation tiers

**Status:** accepted, supersedes decision 0016. Its declination mechanism and
three-mode render surface (`none`/`outline`/`parent`) are superseded in turn
by decision 0019 after the owner compared all three on the live map and
rejected declination -- the palette itself (10 families, 4 shades, the
measurements below) is unaffected and still current. See 0019 for the
argument.

## Context

Decision 0016 split the palette into two tiers told apart by saturation:
sprawling polities (colonial empires, federations -- anything whose territory
reads as scattered pieces rather than one blob) at 62% saturation,
graph-coloured against each other so no two ever on screen together share a
colour; everyone else at 26% saturation, hash-assigned. That guarantee is the
one thing this project cannot give up: a repeated colour between two
sprawling empires reads as an invasion or a colonial claim the map never
actually makes, which is exactly the false assertion CLAUDE.md's "never
invent geometry" principle exists to rule out for polygons and applies just
as much to colour.

Two pieces of owner feedback, after watching "outline" and "parent" mode
(decision from the empire-render-modes work): first, outline mode is too
busy and its stroke too thick -- an empire's members, drawn in their own
unrelated tier-1 or tier-2 colours, do not read as belonging to each other at
all, so the mode does the opposite of what it is for. Second, the palette
itself is bland and dated; the owner wants 1970s character, citing
designworklife.com's 70s palettes and two reference images (a retro sunburst:
adobe red, burnt orange, harvest gold, cream, teals; a wave pattern: orange,
rust, chocolate, mint-teal, gold, cream).

## Decision

### The palette

10 hue families (hue/saturation pairs), 4 lightness shades each, 40 colours
total:

| Family | Hue | Saturation |
|---|---|---|
| 0 | 0 | 50% |
| 1 | 22 | 30% |
| 2 | 25 | 50% |
| 3 | 40 | 55% |
| 4 | 45 | 50% |
| 5 | 60 | 34% |
| 6 | 90 | 34% |
| 7 | 150 | 26% |
| 8 | 180 | 26% |
| 9 | 200 | 26% |

Shade ladder, lightness: `[74, 58, 42, 28]`.

These families were greedily selected, by measurement, to maximise CIE76
deltaE from a pool restricted to hue/saturation pairs plausible for a 1970s
poster palette -- warm earths (reds, oranges, golds) at higher saturation,
greens and teals muted, deliberately excluding blues and magentas even
though including them would measure better. That restriction *is* the period
character, not a gap in the search: a palette that reached for blue to
improve separation would stop looking like the reference images and start
looking like a generic categorical palette that happens to avoid blue by
coincidence. Saturations sit below the reference hexes (60-100%, chosen for
print) because a continent-sized fill of 100%-saturation burnt orange is
overwhelming on a screen covered edge-to-edge in polygons; muting it is what
makes it usable at map scale rather than poster scale.

Measured minimum CIE76 deltaE: 11.9 across families, 15.3 within a family.
The palette this replaces measured 16.0 (its saturated tier, 40 colours) and
9.9 (its muted tier, 36 colours) -- so the new tier-2-equivalent population
(everyone hash-assigned into this one space) is *better* separated than
before, and the new tier-1-equivalent population is somewhat less separated
in exchange for the period-authentic hue restriction. Both remain well above
the originally shipped single-tier palette's 8.29.

### One shared colour space, not two

Decision 0016 told its two populations apart by giving each a disjoint
saturation band, so a sprawling empire could never coincide with a local
polity's exact colour even when their hues matched by chance. This palette
varies saturation *by hue family*, for period character, not by population
-- the whole point of "warm earths saturated, greens and teals muted" is a
property of the hue, not of which polity wears it. That means there is no
saturation band left to reserve for "everyone else": both populations
(graph-coloured sprawling/aggregate candidates, and hash-assigned everyone
else) now draw from the identical 40-colour space.

**This drops decision 0016's guarantee that a sprawling empire can never
read as just another local polity.** That guarantee is not preserved by
another mechanism here -- it is a real, argued cost of chasing 1970s
character over 0016's cleaner separation, not something the owner asked to
keep. What is preserved, unchanged in mechanism, is the guarantee that
actually matters most: **no two sprawling empires ever on screen together
share a colour.** That is still a hard graph-coloured guarantee, verified
against the real dist/ below.

### Declination: members shade their empire's family

The busy-outline complaint was not really about stroke weight (addressed
separately below) -- it was that a member polity kept an *independent*
colour, unrelated to its empire's, so "these belong together" was never
visible in the fill at all. The fix: a version whose `memberOf` (schema 2,
decision 0017) names an aggregate takes a shade of that aggregate's family
instead of an independent colour. This is new behaviour in "none" mode too,
not just "outline" -- declination is a property of what "a member's own
colour" means, and every mode except "parent" (which already borrows the
aggregate's exact flat colour) shows a component's own colour somewhere.

Concretely: aggregates (any polity ever named by another version's
`memberOf` -- 42 of them against the real dist/) are forced into the same
co-visibility graph as ordinary sprawling polities, using the *union* of
their own versions' intervals and every member-version's intervals recorded
under their name, so an aggregate whose own drawn territory is just a small
metropole (and would never independently qualify as "sprawling") still gets
a colour no co-visible sprawling neighbour shares, and still anchors a
family for its members to borrow. Each aggregate's distinct members are
sorted by id and assigned a shade by position modulo 4 -- deterministic, and
cycling: **shade repeats inside one empire past the fourth member are
expected and acceptable, not a bug.** The shared hue already says "same
empire," and the ordinary per-polity outline separates any two neighbours
that land on the same shade. (This is stated directly in a code comment in
`palette.ts` so a future pass does not "fix" it by growing the shade ladder.)

Members do not compete for a graph-coloured slot of their own at all --
**declination wins over the sprawl guarantee for members.** A colonial
territory whose own bounding box spans continents (French Indochina, Dutch
East Indies, and 35 others measured against the real dist/) is excluded from
the sprawl-candidate pool entirely, because its colour is never independent
of its empire's in the first place. The sprawl guarantee keeps binding
every non-member, aggregates included.

**Does that trade actually bite?** Measured against the real dist/: 37
member polities independently qualify as sprawling by the 45-degree bbox
test and are excluded from the graph on that account. Checking each one's
declined colour against every other co-visible sprawl/aggregate candidate
finds **49 real collisions** -- for example New France (a member of the
Kingdom of France) shares its declined `hsl(0 50% 42%)` with the
independently-sprawling English Colonial Empire while both are on screen,
and the Dutch East Indies (a member of the Batavian Republic) shares
`hsl(180 26% 74%)` with the United States. These are real, on the map, and
this decision accepts them as the cost of declination: the alternative --
excluding a member from declination whenever its own bbox happens to
qualify as sprawling -- would reintroduce exactly the "scattered pieces in
unrelated colours" problem declination exists to fix, for the specific
territories (huge colonial holdings) most likely to trigger it. A member's
family match to its own empire is worth more, on the map, than its
mismatch from an unrelated empire it happens to share a screen with.

### Verified against the real dist/ (schema 2, 13,380 versions)

- Candidates in the shared co-visibility graph: 42 aggregates + 112
  independently-sprawling non-aggregate polities = 154, margin-widened at
  `CO_VISIBILITY_MARGIN_YEARS` = 8 (unchanged derivation from decision 0016).
  Max degree 97, median 35 -- denser than decision 0016's own sprawl-only
  graph (max degree 91) because folding aggregates in adds nodes and edges
  the old graph never had. Greedy colouring needs 36 of the 40 reserved
  colours.
- **Sprawling-empire conflict count at the fade margin: 0.** No overflow
  warning fired.
- Maximum simultaneously-live aggregates in one real year: 9 (matches the
  measured fact this palette was sized against -- 10 families is enough with
  one to spare).
- The 1929 French colonial group -- French Africa, French Indochina, French
  Mandate for Syria and Lebanon, and French Third Republic -- are, at that
  year, four member rows of the same aggregate (`(French Third Republic)`).
  All four resolve to family 5 (hue 60, saturation 34%), at four different
  shades: French Africa 74%, French Indochina 58%, French Mandate for Syria
  and Lebanon 42%, French Third Republic 28%. All four members, all four
  shades used once each -- exactly what "<=4 members" is supposed to look
  like.
- The empire with the most simultaneous members in a single year is Taifas
  of Iberia in 1046, with 20 -- matching this project's own measured
  members-per-empire-year maximum exactly. All 20 resolve to family 9 (hue
  200, saturation 26%), cycling the four shades five times over; several
  pairs (e.g. Taifa of Dénia and Taifa of Seville, both 58%) share a shade,
  which is the expected, accepted repeat this decision argues for above.

### Outline weight

`AGGREGATE_OUTLINE_WIDTH` moves from 3px to 1.5px. At 3px, against unrelated
tier colours, the stroke had to do all the work of saying "this is one
empire" by itself, and the owner reported it reading as heavy-handed. With
declination doing most of that work in the fill now, the stroke only needs
to be *perceptibly* heavier than the ordinary 1px per-polity seam, not
dominant. 1.5px was chosen as the smallest step that stays visually distinct
from 1px at typical screen density without competing with the family-shaded
fills underneath it; this has not been judged by a human watching the map,
same caveat decision 0016 closed on.

### Ground tones

`canvas.ts`'s `SEA` (#101b26), `LAND` (#2b3440) and `FLASH` (#fdf6e3) were
judged, not re-measured, against the new palette. `SEA` is
`hsl(210 41% 11%)` and `LAND` is `hsl(214 20% 21%)` -- both cool, dark,
low-saturation blue-grays. Every territory family is either warm or a muted
green/teal at meaningfully higher lightness and a different hue; the closest
is the teal family's darkest shade, `hsl(200 26% 28%)`, still 7 points
lighter and 6 points more saturated than `LAND` with a 14-degree hue gap,
and every fill also carries its own dark `OUTLINE` seam (`#04070a`) on top
regardless. Decision 0003's requirement -- three ground tones, unclaimed
land never confusable with sea, territory the only saturated thing on
screen -- still holds. `FLASH`'s cream (`hsl(44 87% 94%)`) already reads as
exactly the period cream both reference palettes use, so it needed no
change either; a fortunate coincidence, not a redesign. Neither tone was
touched.

## Consequences

- `Palette` gains `colourForMember(aggregatePolityId, memberPolityId)`
  alongside `colourFor`. `colourFor` alone cannot express declination, since
  membership is a per-version fact (decision 0017: "a polity can be
  independent in one stretch and a member of an aggregate in another"), not
  a per-polity one -- `colourForDraw` (render-mode.ts) already receives the
  specific version's `memberOf` and is the one place that routes to the
  right method.
- `fixtures/dist` has zero rows with a non-null `memberOf`, so nothing about
  declination is exercised by the real-fixture golden-vector test. A
  synthetic artifact (`render.test.ts`, "palette: declination") is the only
  place declination is actually checked -- without it, this feature would
  ship with a test suite that could not fail on it.
- The golden colour vector is regenerated for the new palette. It was
  verified to actually bite: temporarily changing `FAMILIES[0]`'s hue from 0
  to 5 fails the golden-vector test naming every fixture polity whose colour
  moved (four of the twelve); restoring it returns to green.
- Decision 0016's "never gives a sprawling polity the same colour as a
  compact one" test is removed, not weakened, because that guarantee no
  longer exists -- see "One shared colour space, not two" above. A test
  asserting it would be asserting something this design deliberately does
  not do.
- This has not been judged by a human watching the map, same as every
  palette decision before it. The owner is still comparing render modes;
  this is the palette they will be looking at while doing so.
