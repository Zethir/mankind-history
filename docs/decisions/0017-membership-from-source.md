# 0017 - Membership carries the source's own `MemberOf`, not derived `Components`

**Status:** accepted

## Context

French colonies in Africa do not share a colour with metropolitan France on
the map, because Cliopatria models `French Africa` and `French Third
Republic` as separate polities. The source already states the relationship:
`French Africa.MemberOf = (French Third Republic)`, and the aggregate row
`(French Third Republic).Components` lists `French Africa` back. The pipeline
discarded both fields. `docs/standards.md`'s one non-negotiable rule -- never
assert something the data cannot support -- means grouping is only honest
here because the source says so, not because geometry or area arithmetic
imply it (both were tried; only 26% of parenthesised polities are
geometrically covered by their co-live neighbours, too unreliable to found a
build-time inference on).

Membership varies by row, not by polity: a polity can be independent in one
stretch and a member of an aggregate in another (e.g. `Kingdom of Great
Britain` before and after the two rows checked below). It belongs on
`Version`, not `Polity`.

## Decision

`Version.memberOf: string | null` carries `MemberOf` resolved to a polity id
through the exact path identity resolution already uses: `resolvePolityId`
(decision 0011) with `aliases.json` applied the same way, so a renamed
aggregate does not dangle just because the rename was caught for `polityId`
but not re-applied here.

`Components` is not carried. It is the inverse of `MemberOf` and, on the rows
checked, agrees with it: `(British Empire).Components` lists `Kingdom of
Great Britain`, and that polity's own `MemberOf` rows point back to
`(British Empire)`. Storing both invites them to disagree on some future row;
`MemberOf` alone cannot.

86 rows (all early medieval succession chains -- Merovingian/Carolingian
Franks, Holy Roman Empire/Bohemia, Polish-Lithuania) carry a
semicolon-separated pair instead of a single name, e.g.
`(Merovingian Empire);(Kingdom of the Franks)`. Checked against each named
polity's own `Components`: the first name is always the aggregate that
actually groups multiple sibling polities (`(Merovingian Empire)`'s
`Components` lists `Kingdom of the Franks` alongside others); the second is a
narrower same-territory self-wrapper whose own `Components` is just itself
plus at most one or two entries. `toMemberOf` keeps only the first name.

A `MemberOf` name that resolves to no polity in the build's own final polity
set is a dangling reference -- `MemberOf` and every row's `Name` are supposed
to draw from the same namespace, so a dangling one means the identity
strategy has a hole, not that the data is merely incomplete. Per
`docs/standards.md`, validation failures fail the build rather than warn:
`resolveMembership` throws, naming every distinct dangling name, if any
survive `aliases.json`. Measured on the pinned release: zero.

## Consequences

- Colour grouping in the viewer can key on `memberOf` for a version and get
  an aggregate's colour, but only where the source states the relationship --
  most polities (no `MemberOf`) stay ungrouped, which is correct: the absence
  is the source's, not an artifact of this pipeline declining to guess.
- `SCHEMA_VERSION` moves from 1 to 2. `fixtures/dist/` is re-blessed; the only
  diff is `memberOf` on every version and the schema version everywhere it
  appears.
- A future upstream release that adds a real disagreement between `MemberOf`
  and `Components` is invisible to this pipeline, because `Components` is
  never read. If that turns out to matter, the fix is to read `Components` in
  the normalise stage as a cross-check that fails the build on disagreement,
  not to start trusting it as its own source of truth.
