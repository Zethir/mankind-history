import type { Polity } from "@history/model";
import { normalizeName, polityIdFor } from "@history/model";
import type { NormalisedRow } from "./normalise";

/** A hand-maintained fix in packages/pipeline/aliases.json. Decision 0007. */
export interface AliasEntry {
  match: { name?: string; wikidata?: string };
  canonical: string;
  reason: string;
}

export function resolvePolityId(
  row: Pick<NormalisedRow, "name" | "wikidata">,
  aliases: AliasEntry[],
): string {
  for (const alias of aliases) {
    if (alias.match.wikidata !== undefined && alias.match.wikidata === row.wikidata) {
      return alias.canonical;
    }
    if (alias.match.name !== undefined && alias.match.name === row.name) {
      return alias.canonical;
    }
  }
  return polityIdFor(row.name);
}

/** Rows discarded by first-non-null-wins because they disagreed with an already-assigned value. */
export interface IdentityConflicts {
  wikidata: number;
  wikipedia: number;
  seshat: number;
}

export interface IdentityResult {
  polities: Polity[];
  /** Positionally aligned with the input rows. */
  rowPolityIds: string[];
  /**
   * Counts of rows whose non-null identifier disagreed with the value already
   * assigned to the polity. First-non-null still wins -- changing that is out
   * of scope here -- but the discarded values stay visible instead of
   * vanishing silently, consistent with how every other drop in this pipeline
   * is counted and reported.
   */
  conflicts: IdentityConflicts;
}

export function assignIdentity(rows: NormalisedRow[], aliases: AliasEntry[]): IdentityResult {
  const byId = new Map<string, Polity>();
  const rowPolityIds: string[] = [];
  const conflicts: IdentityConflicts = { wikidata: 0, wikipedia: 0, seshat: 0 };

  for (const row of rows) {
    const id = resolvePolityId(row, aliases);
    rowPolityIds.push(id);

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        name: row.name,
        normalizedName: normalizeName(row.name),
        wikidata: row.wikidata,
        wikipedia: row.wikipedia,
        seshat: row.seshat,
      });
      continue;
    }
    // First non-null wins, so a polity keeps every identifier any of its rows
    // carries without depending on which row happened to come first. When the
    // slot is already filled with a *different* non-null value, that later
    // value is what gets discarded -- count it rather than let it vanish.
    if (existing.wikidata === null) existing.wikidata = row.wikidata;
    else if (row.wikidata !== null && row.wikidata !== existing.wikidata) conflicts.wikidata++;
    if (existing.wikipedia === null) existing.wikipedia = row.wikipedia;
    else if (row.wikipedia !== null && row.wikipedia !== existing.wikipedia) conflicts.wikipedia++;
    if (existing.seshat === null) existing.seshat = row.seshat;
    else if (row.seshat !== null && row.seshat !== existing.seshat) conflicts.seshat++;
  }

  const polities = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { polities, rowPolityIds, conflicts };
}

/** See decision 0017. */
export interface MembershipResult {
  /** Positionally aligned with the input rows. Resolved polity id, or null. */
  rowMemberOfIds: Array<string | null>;
  /** Rows whose (coerced, first-token) MemberOf field was non-null. */
  withMemberOf: number;
  /** Distinct resolved aggregate polity ids referenced across all rows. */
  distinctAggregates: number;
}

/**
 * Resolve each row's raw `MemberOf` name to a polity id, through the same
 * `resolvePolityId` + `aliases.json` path identity resolution itself uses
 * (decision 0011), so a renamed aggregate does not dangle just because the
 * rename was caught for `polityId` but not re-applied here. `wikidata` is
 * always null for the lookup because `MemberOf` carries only a Name -- an
 * alias keyed on `wikidata` cannot match a bare name and is not expected to;
 * every alias in the pinned release's `aliases.json` is name-keyed.
 *
 * A resolved id absent from `polityIds` (the build's own final polity set) is
 * a dangling reference: the identity strategy has a hole, since `MemberOf`
 * and every row's own `Name` are supposed to draw from the same namespace.
 * docs/standards.md requires validation failures to fail the build rather
 * than warn, so this throws -- matching deriveLineage's own duplicate/overlap
 * checks -- rather than silently emitting `memberOf: null` for a row whose
 * source plainly asserted a relationship.
 */
export function resolveMembership(
  rows: ReadonlyArray<Pick<NormalisedRow, "memberOf">>,
  aliases: AliasEntry[],
  polityIds: ReadonlySet<string>,
): MembershipResult {
  const rowMemberOfIds: Array<string | null> = [];
  const aggregates = new Set<string>();
  const dangling: string[] = [];
  let withMemberOf = 0;

  for (const row of rows) {
    if (row.memberOf === null) {
      rowMemberOfIds.push(null);
      continue;
    }
    withMemberOf++;
    const id = resolvePolityId({ name: row.memberOf, wikidata: null }, aliases);
    if (!polityIds.has(id)) {
      dangling.push(row.memberOf);
      rowMemberOfIds.push(null);
      continue;
    }
    aggregates.add(id);
    rowMemberOfIds.push(id);
  }

  if (dangling.length > 0) {
    const distinct = [...new Set(dangling)].sort();
    throw new Error(
      `${dangling.length} version(s) carry a MemberOf name that resolves to no polity in this ` +
        `build (${distinct.length} distinct name(s)). Fix the data or add an alias.\n  ` +
        `${distinct.slice(0, 20).join("\n  ")}`,
    );
  }

  return { rowMemberOfIds, withMemberOf, distinctAggregates: aggregates.size };
}
