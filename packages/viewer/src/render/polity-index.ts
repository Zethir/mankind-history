import type { VersionsArtifact } from "@history/model";

/**
 * Maps a version id to the polity it belongs to. Colour is a property of the
 * polity, not the version (see palette.ts and decision 0001), so every draw
 * must resolve through this map on its way to colourFor -- never pass a
 * version id to colourFor directly, and never fall back to one when a lookup
 * misses. A version id absent from the index yields no entry: the caller's
 * job is to skip that draw, not invent a colour for it.
 *
 * Kept out of canvas.ts so it can be tested under environment: "node" with no
 * DOM in scope, and so the version-to-polity composition -- the place the bug
 * decision 0001 describes could actually occur -- has a boundary of its own,
 * separate from colourFor's.
 */
export function buildPolityIndex(versions: VersionsArtifact): Map<string, string> {
  const index = new Map<string, string>();
  for (const row of versions.rows) {
    index.set(row.id, row.polityId);
  }
  return index;
}
