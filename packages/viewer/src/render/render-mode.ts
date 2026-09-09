import type { Palette } from "./palette";
import type { PolityIndexEntry } from "./polity-index";

/**
 * How aggregate polities -- imperial or dynastic unions whose components are
 * separately-drawn polities, per `Version.memberOf` (schema 2, decision 0017)
 * -- render relative to their members. Switchable at runtime from the chrome
 * so the owner can compare them; see docs/decisions/0018-family-palette.md
 * for why "none" and "outline" no longer give a member its own independent
 * colour.
 *
 * - "none": a component is filled with a *declined* colour -- a shade of its
 *   aggregate's family (`Palette.colourForMember`), not an independent
 *   colour of its own -- and, being large, the aggregate itself is buried
 *   under its own components (draw order is descending area).
 * - "outline": components are filled the same declined way as "none". Each
 *   aggregate polity live in the frame additionally gets its outline
 *   stroked over the top, in its own colour (`colourFor`, which is itself
 *   family-consistent -- see palette.ts), at a heavier width than the
 *   ordinary per-polity outline. The aggregate's fill stays exactly where it
 *   is in "none" -- buried -- only its stroke is lifted above. Combined with
 *   declination, the whole group now reads as shades of one hue plus one
 *   outline, not a scatter of unrelated colours.
 * - "parent": every component is filled with its aggregate's own colour
 *   instead of a declined shade, so the whole group reads as one flat
 *   colour. The aggregate's own version has `memberOf: null` (decision
 *   0017's own example), so this function routes it to `colourFor(polityId)`
 *   same as an unaffiliated polity -- which is the very colour its
 *   components then borrow, with no special-casing of "is this draw the
 *   aggregate itself" needed.
 */
export type RenderMode = "none" | "outline" | "parent";

/**
 * The one place mode, membership and palette meet: pure, and canvas-free, so
 * it is testable under environment: "node" -- see render-mode.test.ts. Never
 * called with a version id; always with the entry a version already resolved
 * to via `buildPolityIndex`, so the version-to-polity boundary decision 0001
 * cares about stays in exactly one place.
 *
 * `knownPolityIds` guards a `memberOf` that names a polity absent from this
 * artifact. Zero such rows exist against the real dataset (2,656 of 13,380
 * versions carry memberOf, across 42 aggregates, zero dangling references --
 * decision 0017 fails the pipeline build on a dangling name) but this
 * function must not assume that stays true forever: falling back to the
 * member's own polity id (via `colourFor`, not `colourForMember`, since
 * there is no real aggregate to decline against) is the same "skip rather
 * than invent" discipline `buildPolityIndex` already applies to an
 * unindexed version id.
 */
export function colourForDraw(
  entry: PolityIndexEntry,
  mode: RenderMode,
  palette: Palette,
  knownPolityIds: ReadonlySet<string>,
): string {
  const isKnownMember = entry.memberOf !== null && knownPolityIds.has(entry.memberOf);
  if (!isKnownMember) {
    return palette.colourFor(entry.polityId);
  }
  const aggregatePolityId = entry.memberOf as string;
  if (mode === "parent") {
    return palette.colourFor(aggregatePolityId);
  }
  return palette.colourForMember(aggregatePolityId, entry.polityId);
}
