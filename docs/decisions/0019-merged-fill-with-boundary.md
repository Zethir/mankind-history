# 0019 — Merged fill with a boundary outline, declination tried and rejected

**Status:** accepted, amends decision 0018

## Context

Decision 0018 shipped the 1970s family palette (kept, unchanged by this
record) alongside three switchable render modes for how an empire's members
relate to it on screen: "none" (declination only), "outline" (declination
plus the aggregate's own boundary stroked in its own colour), and "parent"
(every member flattened to the aggregate's exact colour, no boundary). The
owner compared all three on the live map. Verbatim on the outcome: *"it's
unreadable when two empires share their declinations. What about merged but
with a small outline to distinguish what's in the empire and what is not if
they share the same color?"*

That is a verdict on two separate things at once, and this record treats
them separately because a future reader might otherwise only remember one:

1. **Declination is rejected.** Shading every member of an empire as a tint
   of one family hue was the owner's own suggestion (decision 0018's
   context), built, and measured. It fails specifically at adjacency: two
   empires whose members are geographically next to each other each read as
   a spread of shades of their own hue, and two adjacent spreads read as
   visual noise rather than as "these are two different empires." The
   palette's hue/saturation design was never the problem -- the owner did
   not ask for the 70s palette to change -- declination, the *mapping* of
   member-to-colour on top of that palette, was.
2. **Merged fill is chosen**, with a new requirement neither shipped mode
   fully had: a boundary outline distinct enough from an ordinary polity
   seam that an empire's extent stays legible even when an unrelated
   neighbour happens to land on the same colour as the empire (a real
   possibility now that members share their aggregate's exact colour, and
   already possible before under plain hash collisions).

## Decision

### Declination is removed; colour assignment reverts to one colour per polity

`Palette.colourForMember` (decision 0018) is deleted. `colourFor` is once
again the only lookup any polity needs, exactly as decision 0016 first
specified: the co-visibility graph (sprawling polities and aggregates
together, `CO_VISIBILITY_MARGIN_YEARS`-widened) is unchanged in mechanism,
still graph-coloured against the 1970s palette's 40 colours, still
hash-assigned for everyone else. Nothing about *how a colour is assigned to
a polity* changes in this record -- only what a member's *drawn* colour is
(below), and that declination's per-version override on top of the
assignment is gone.

This also fixes a real defect decision 0018 measured and accepted as a
trade-off: because a declining member never used its own earned graph
colour (it used a shade of its aggregate's family instead), a member that
independently qualified as sprawling could still occupy a slot in the
co-visibility graph -- the candidate-selection loop never actually excluded
members, despite 0018's context describing it that way -- while its
*rendered* colour ignored that slot entirely. The result was 49 measured
collisions on the real dist/ (e.g. New France, a member of the Kingdom of
France, sharing its declined `hsl(0 50% 42%)` with the independently
sprawling English Colonial Empire while both were on screen). Removing
declination means a member's rendered colour (in "off" mode, or for a
non-member draw in "on" mode) is always its own `colourFor` result -- the
same slot the graph already reserved for it. Verified against the real
dist/ (schema 2, `versions.0.json`, 13,380 rows, 154 sprawl/aggregate
candidates -- matching decision 0018's own count): **0 conflicts**, down
from 49.

### Merged fill

A version whose `memberOf` names a polity present in this artifact is
filled with that aggregate's `colourFor` result, not its own. This is
exactly decision 0018's "parent" mode, kept and renamed: `RenderMode` is now
`"off" | "on"` (below), and `colourForDraw`'s `"on"` branch is
`"parent"`'s old body verbatim, just no longer competing against two
sibling modes.

The aggregate's own version (`memberOf: null` on its own row, decision
0017) keeps being drawn -- nothing in this change skips it. It already drew
in every prior mode, sorted first in the area-descending draw order, so it
sits under its components rather than over them; that ordering is
unchanged. Drawing it matters because an aggregate's own listed territory
does not always equal the union of its components' listed territory --
`(British Empire)` in the current data is 28.0M km2 while the versions
naming it as `memberOf` sum to less -- so skipping the aggregate's own
version would leave holes in the merged colour where only the aggregate's
own polygon, not any component's, covers the ground.

Verified against the real dist/: the 1929 French colonial group -- French
Africa, French Indochina, French Mandate for Syria and Lebanon, French
Third Republic, and the aggregate `(French Third Republic)` itself -- all
five resolve to the identical colour, `hsl(60 34% 42%)`. (This is one shade
per empire now, not decision 0018's four cycling shades -- merging
collapses the whole group to whatever single colour the aggregate itself
earned in the graph.)

### The empire boundary

Every aggregate live in the current frame has its polygon's boundary
stroked over all fills, in `"on"` mode. Two changes from decision 0018's
"outline" mode:

- **Stroke colour.** The old "outline" mode stroked the aggregate's boundary
  in the aggregate's *own* colour (`palette.colourFor`). That was fine when
  members kept independent colours, but is exactly wrong once fill and
  boundary are meant to coexist on the same coloured shape: a same-colour
  stroke over a same-colour fill is invisible, precisely in the case this
  boundary exists for (an unrelated neighbour sharing the empire's colour).
  The boundary now strokes in `OUTLINE` (`#04070a`, canvas.ts's existing
  dark ground-tone-adjacent colour, decision 0003), the same colour already
  used for every ordinary per-polity seam.
- **Weight, as a ratio.** Since both strokes are now the same colour, the
  only thing separating "this is an internal seam" from "this is the
  empire's edge" is width. The ordinary per-polity outline moves from 1px to
  **0.75px**; the empire boundary stays at decision 0018's **1.5px**. The
  owner called this project's very first attempt, a 3px empire stroke,
  "super thick" -- a ratio of 2:1 (0.75 vs 1.5) reads as "heavier, on
  purpose" without either line being thick in isolation, which a same-width
  colour-only distinction (impossible now that both use `OUTLINE`) could
  not have given anyway. This has not been judged by a human watching the
  map, the same caveat every stroke-weight decision in this project has
  shipped with.

### Three modes to two

`RenderMode` narrows from `"none" | "outline" | "parent"` to `"off" | "on"`.
"off" is the pre-change baseline (every polity its own `colourFor` colour,
no merging, no empire boundary) kept solely so the owner can still compare
against it. "on" is merged fill plus the empire boundary -- the chosen
design, and the default, since this is now the intended behaviour rather
than an experiment being evaluated. The chrome's control is relabelled
"Empires: Off / Merged".

## Consequences

- `Palette.colourForMember` is deleted; `Palette` is `{ colourFor(id):
  string }` again. `render-mode.ts`'s `colourForDraw` is the only place
  membership and mode meet, unchanged in that respect from decision 0018.
- The declination-only tests (`render.test.ts`'s "palette: declination"
  block, and the `"none"`/`"outline"`-specific cases in
  `render-mode.test.ts`) are deleted rather than weakened, because the
  behaviour they asserted no longer exists. New tests cover the merged path
  against a synthetic artifact with a real `memberOf` (fixtures/dist has
  zero such rows, measured, so this is the only place it is exercised): a
  member resolves to its aggregate's real palette colour, a non-member is
  unaffected, and a member whose `memberOf` names a polity absent from the
  artifact falls back to its own colour without crashing.
- The golden colour vector (`render.test.ts`) is unchanged in value --
  reverting declination does not touch `colourFor`'s graph/hash assignment,
  only what a member's *draw* resolves to -- but was re-verified to still
  bite: temporarily changing `FAMILIES[0]`'s hue from 0 to 5 fails it,
  naming the same four fixture polities decision 0018's own verification
  named, and restoring it returns to green.
- Decision 0018's palette measurements (10 families, 4 shades, minimum
  deltaE 11.9 across families) are untouched by this record and still hold;
  only its declination mechanism and its three-mode surface are superseded.
