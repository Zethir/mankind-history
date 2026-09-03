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
