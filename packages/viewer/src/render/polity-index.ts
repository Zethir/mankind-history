import type { VersionsArtifact } from "@history/model";

/**
 * What a version resolves to: the polity it belongs to (colour is a property
 * of the polity, not the version -- see palette.ts and decision 0001), and
 * the aggregate polity it was a member of that year, or null (`Version.
 * memberOf`, schema 2, decision 0017 -- e.g. French Africa's `memberOf` names
 * the French Third Republic).
 */
export interface PolityIndexEntry {
  polityId: string;
  memberOf: string | null;
}

/**
 * Maps a version id to its polity and its membership. Every draw must
 * resolve through this map on its way to a colour -- never pass a version id
 * to a palette directly, and never fall back to one when a lookup misses. A
 * version id absent from the index yields no entry: the caller's job is to
 * skip that draw, not invent a colour for it.
 *
 * `memberOf` is folded into this same map, rather than built as a second
 * version-to-memberOf map alongside it, because it is exactly the same
 * lookup shape as polityId: both are per-version facts read off one row
 * (`versions.rows`), both are needed at the same draw sites, and both fail
 * closed the same way (an unindexed version id skips the draw entirely,
 * never guesses). A caller that has already paid for the lookup has both
 * facts in hand instead of needing a second Map.get with its own miss
 * semantics to reconcile against the first.
 *
 * Kept out of canvas.ts so it can be tested under environment: "node" with no
 * DOM in scope, and so the version-to-polity (and version-to-membership)
 * composition -- the place the bug decision 0001 describes could actually
 * occur -- has a boundary of its own, separate from colourFor's.
 */
export function buildPolityIndex(versions: VersionsArtifact): Map<string, PolityIndexEntry> {
  const index = new Map<string, PolityIndexEntry>();
  for (const row of versions.rows) {
    index.set(row.id, { polityId: row.polityId, memberOf: row.memberOf });
  }
  return index;
}
