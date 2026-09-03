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

export interface IdentityResult {
  polities: Polity[];
  /** Positionally aligned with the input rows. */
  rowPolityIds: string[];
}

export function assignIdentity(rows: NormalisedRow[], aliases: AliasEntry[]): IdentityResult {
  const byId = new Map<string, Polity>();
  const rowPolityIds: string[] = [];

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
    // carries without depending on which row happened to come first.
    if (existing.wikidata === null) existing.wikidata = row.wikidata;
    if (existing.wikipedia === null) existing.wikipedia = row.wikipedia;
    if (existing.seshat === null) existing.seshat = row.seshat;
  }

  const polities = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { polities, rowPolityIds };
}
