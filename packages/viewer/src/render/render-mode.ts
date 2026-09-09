import type { Palette } from "./palette";
import type { PolityIndexEntry } from "./polity-index";

/**
 * How aggregate polities -- imperial or dynastic unions whose components are
 * separately-drawn polities, per `Version.memberOf` (schema 2, decision 0017)
 * -- render relative to their members. Switchable at runtime from the chrome
 * so the owner can compare them; see docs/decisions (none of this changes
 * decision 0016's palette tier logic, only which polity id a draw looks its
 * colour up under).
 *
 * - "none": today's behaviour. The aggregate is drawn like any other polity
 *   and, being large, is buried under its own components (draw order is
 *   descending area). Every component keeps its own colour.
 * - "outline": components keep their own colours, same as "none". Each
 *   aggregate polity live in the frame additionally gets its outline
 *   stroked over the top, in its own colour, at a heavier width than the
 *   ordinary per-polity outline. The aggregate's fill stays exactly where it
 *   is in "none" -- buried -- only its stroke is lifted above.
 * - "parent": every component is filled with its aggregate's colour instead
 *   of its own, so the whole group reads as one colour. The aggregate's own
 *   version has `memberOf: null` (decision 0017's own example), so this
 *   function routes it to `colourFor(polityId)` same as "none" -- which is
 *   the very colour its components then borrow, with no special-casing of
 *   "is this draw the aggregate itself" needed.
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
 * member's own polity id is the same "skip rather than invent" discipline
 * `buildPolityIndex` already applies to an unindexed version id.
 */
export function colourForDraw(
  entry: PolityIndexEntry,
  mode: RenderMode,
  palette: Palette,
  knownPolityIds: ReadonlySet<string>,
): string {
  if (mode === "parent" && entry.memberOf !== null && knownPolityIds.has(entry.memberOf)) {
    return palette.colourFor(entry.memberOf);
  }
  return palette.colourFor(entry.polityId);
}
