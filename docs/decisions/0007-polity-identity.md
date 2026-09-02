# 0007 — Polity identity across upstream releases

**Status:** accepted

## Context

Cliopatria is versioned and will re-release. Lineage (`prev_id`, `delta`, `gap`)
and stable colour both depend on recognising that a polity in release N is the
same polity as in release N+1. The Phase 0 spike hashes the name, which breaks
the moment anything is renamed: the polity becomes a new entity, loses its
colour, and its entire lineage chain resets. Decision 0004 depends on lineage,
so this breaks the expansion flash too.

## Decision

Key on the **Wikidata id** where present, falling back to a normalised name.
Store the Wikidata id, the normalised name and the SeshatID on every polity, so
a later change of strategy has something to work from.

Wikidata Q-ids are permanent identifiers and survive relabelling: renaming the
item does not change the id. They are not perfectly stable — items get merged
(leaving a redirect), are occasionally deleted, and some Cliopatria rows carry
no Wikidata id at all.

So the real mechanism is not a perfect key. It is a **detector**:

> On every upstream bump, the build reports how many polities failed to match a
> polity in the previous build.

Three unmatched polities is a hand-fix in `aliases.json`. Three hundred means
something changed structurally upstream and you want to know before shipping,
not after.

## Consequences

- One extra acceptance check, and one small hand-maintained alias file.
- Requires keeping the previous build's `polities.json` available for diffing.
- Perfection is explicitly not the goal. The goal is to be told when identity
  breaks, quickly enough to fix it cheaply.
