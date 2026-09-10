import type { Palette } from "./palette";
import { resolveAggregateRoot } from "./palette";
import type { PolityIndexEntry } from "./polity-index";

/**
 * Whether aggregate polities -- imperial or dynastic unions whose components
 * are separately-drawn polities, per `Version.memberOf` (schema 2, decision
 * 0017) -- render merged with their members or not. Three modes ("none",
 * "outline", "parent") were tried and compared on the live map; see
 * docs/decisions/0019-merged-fill-with-boundary.md (and 0016/0018 for the
 * palette history behind them). The owner picked one design, so this is now
 * an on/off toggle rather than a choice of mechanism:
 *
 * - "off": every polity, aggregate or member, renders its own `colourFor`
 *   colour, with no merging and no empire boundary. This is the pre-change
 *   baseline, kept so the owner can still compare against it. Note this means
 *   the proximity graph's no-collision guarantee (palette.ts,
 *   `buildProximityGraph`) does not hold here: that graph's edges are keyed
 *   by each version's *root-resolved drawn identity* (a member's aggregate,
 *   not the member itself), so a member's own unconstrained `colourFor`
 *   result -- what "off" mode actually draws -- can still collide with a
 *   touching neighbour. Acceptable for a comparison baseline, but worth
 *   stating since it is not the guarantee "on" mode makes.
 * - "on": a component is filled with its aggregate's colour (`colourFor
 *   (memberOf)`), so the whole group reads as one flat colour, and every live
 *   aggregate additionally gets its boundary stroked over the top (canvas.ts)
 *   so the empire's extent stays visible even where an unrelated neighbour
 *   happens to share its colour. This is the intended, shipped behaviour and
 *   the default.
 */
export type RenderMode = "off" | "on";

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
 * member's own polity id (via `colourFor`) is the same "skip rather than
 * invent" discipline `buildPolityIndex` already applies to an unindexed
 * version id.
 *
 * `aggregateParents` resolves a known member's immediate `memberOf` to its
 * *root* aggregate (`resolveAggregateRoot`, palette.ts) before looking up a
 * colour, because `memberOf` nests: an aggregate can itself be a member of a
 * further aggregate (Kingdom of Bohemia -> Holy Roman Empire, Kingdom of
 * Poland -> Polish-Lithuania Kingdom, against the real dist/). Resolving only
 * one level would draw the nested aggregate's own polygon in its parent's
 * colour while its members draw in the nested aggregate's colour -- one
 * empire reading as two.
 */
export function colourForDraw(
  entry: PolityIndexEntry,
  mode: RenderMode,
  palette: Palette,
  knownPolityIds: ReadonlySet<string>,
  aggregateParents: ReadonlyMap<string, string>,
): string {
  if (mode === "off") {
    return palette.colourFor(entry.polityId);
  }
  const isKnownMember = entry.memberOf !== null && knownPolityIds.has(entry.memberOf);
  if (!isKnownMember) {
    return palette.colourFor(entry.polityId);
  }
  const root = resolveAggregateRoot(entry.memberOf as string, aggregateParents);
  return palette.colourFor(root);
}
