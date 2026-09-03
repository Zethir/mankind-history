# 0011 - Polity identity keys on the upstream Name

**Status:** accepted

This amends decision 0007.

## Context

0007 keyed a polity on its Wikidata id where present, falling back to a
normalised name. Running identity resolution against the real 13,380-row
Cliopatria dataset showed this to be wrong in both directions.

Cliopatria's own README states the entity lookup rule directly: find "the row
(if any) containing the Name of the entity where the year of interest is
between FromYear and ToYear". Name is the upstream entity key. Wikidata is
described there as per-row metadata "for the entity in those years" - an
annotation, not an identifier.

Measured on the pinned release, Wikidata fails as a key both ways:

- **Reused across distinct polities.** `wd:Q7462` covers *Song*, *Northern
  Song* and *Southern Song*. `wd:Q41137` covers *Assyria* and *Syria*.
- **Varies within one entity.** 2 of 1,583 names (e.g. "Timurid Empire") carry
  rows with a Wikidata id and rows with none.

Keying on the raw Name gives 0 duplicate `(polity, from_year)` groups and
1,583 entities, close to the README's own count of "over 1600 political
entities." Keying on Wikidata produced 1,407 and, before a first attempt at
patching it with a composite key, 955 duplicate groups across 52 polities;
the composite-key patch was itself found to be wrong, since normalising the
name merges "Macedonian Empire" with "(Macedonian Empire)", which the source
lists as two distinct rows over identical year ranges.

## Decision

`resolvePolityId` keys on the raw upstream `Name`, unnormalised:
`name:<Name>`. It is not run through `normalizeName` for the key, because
normalisation is not injective over this dataset - it collapses parenthesised
and bare labels that the source treats as different territories. Wikidata is
still stored on `Polity.wikidata` as metadata, matching what the README says
it is for.

## Consequences

- An upstream rename, or a change in parenthesisation, now starts a new
  entity. 0007's deferred drift report - matching the previous build's
  polities against the new one - and `aliases.json` are the mitigations: a
  handful of renames show up as unmatched polities and get a one-line alias,
  the same mechanism 0007 already relied on for an unrecognised Wikidata id.
- Two rows with the same Name and overlapping years are now a real duplicate
  rather than a symptom of over-aggressive keying, so the duplicate-`from_year`
  check in `deriveLineage` is a meaningful signal again.
