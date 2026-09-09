import type { Version, VersionsArtifact } from "@history/model";
import { equalEarthInverse } from "@history/model";
import { FADE_SECONDS, SPEED_STEPS } from "../engine/constants";

/**
 * One family palette, not two saturation tiers.
 *
 * Decision 0016 split the palette into a saturated "tier 1" (sprawling
 * empires, graph-coloured for a hard no-collision guarantee) and a muted
 * "tier 2" (everyone else, hash-assigned), told apart by saturation alone so
 * an empire could never read as just another local polity. That design is
 * superseded, not discarded -- the guarantee it exists to make is preserved
 * below, unchanged in mechanism. What changes is the colour space it draws
 * from and one new rule: an empire's *members* now render as shades of one
 * hue, so the group reads as a family instead of a scatter of unrelated
 * colours. See docs/decisions/0018-family-palette.md for the full argument,
 * including why this drops tier 2's old guarantee that a sprawling empire
 * could never coincide with a local polity's exact colour.
 *
 * The palette itself: 10 hue families (hue/saturation pairs chosen for 1970s
 * character -- warm earths at higher saturation, greens and teals muted, no
 * blues or magentas) x 4 lightness shades = 40 colours total. This replaces
 * both the old 40-colour tier-1 space and the old 36-colour tier-2 space with
 * one shared 40-colour space; there is no longer a separate saturation band
 * for "everyone else."
 *
 * Three populations draw from this one space:
 *
 * 1. Aggregates (any polity ever named by another version's `memberOf` --
 *    Version.memberOf, schema 2, decision 0017) and ordinary sprawling
 *    polities (a version's bounding box spans more than
 *    `SPRAWL_THRESHOLD_DEGREES`) are graph-coloured together against one
 *    co-visibility graph, margin-widened exactly as decision 0016 specified.
 *    Aggregates are forced into this graph regardless of their own bounding
 *    box, using the *union* of their own versions' intervals and every
 *    member-version's intervals recorded under their name -- an aggregate
 *    whose own drawn territory is just a small metropole (so it would never
 *    qualify as "sprawling" on its own bbox) still needs a colour no
 *    co-visible sprawling neighbour shares, and still needs a family for its
 *    members to borrow. Folding both populations into one graph is what
 *    keeps the guarantee true for aggregates too: decision 0016's guarantee
 *    was "no two sprawling empires share a colour" and an aggregate is
 *    exactly that, even when none of its own directly-held territory sprawls.
 *
 * 2. Members (a version whose `memberOf` names a polity in population 1) do
 *    not get their own graph-coloured or hashed colour at all. They borrow
 *    their aggregate's family (the hue/saturation half of whatever colour
 *    population 1 assigned it) and pick a shade deterministically within it
 *    -- see `colourForMember`. This is declination, and it wins over the
 *    sprawl guarantee for members: a member polity that would otherwise
 *    qualify as independently sprawling (e.g. a colonial territory whose own
 *    bounding box spans continents) is excluded from population 1 entirely
 *    and never competes for a graph-coloured slot, because its colour is
 *    never independent of its empire's in the first place. The guarantee
 *    keeps binding non-members, including every aggregate -- see the report
 *    this shipped with for whether that trade actually produces a visible
 *    collision on the real data.
 *
 * 3. Everyone else -- compact, unaffiliated polities -- is hash-assigned into
 *    the same 40-colour space, same mechanism as the old tier 2, just no
 *    longer desaturated relative to population 1.
 */

/** Degrees of longitude a polity's widest version must span to be "sprawling". */
const SPRAWL_THRESHOLD_DEGREES = 45;

/**
 * How many years past a claimed interval's end two co-visibility candidates
 * still count as visible together, because the renderer keeps drawing a
 * fading-out version past `toYear`. See decision 0016 for the full
 * derivation: `FADE_SECONDS * max(SPEED_STEPS)` is the longest fade the fixed
 * speed steps ever produce, `Math.ceil` rounds up, and one more year covers
 * Auto mode's adaptive speed transiently exceeding the fixed steps.
 */
const CO_VISIBILITY_MARGIN_YEARS = Math.ceil(FADE_SECONDS * Math.max(...SPEED_STEPS)) + 1;

/**
 * 10 hue families x 4 lightness shades = 40 colours, picked by measurement
 * (see the report this shipped with) to maximise CIE76 deltaE within a pool
 * restricted to hue/saturation pairs plausible for a 1970s poster palette:
 * warm earths (reds, oranges, golds) at higher saturation, greens and teals
 * muted, deliberately excluding blues and magentas even though they would
 * measure better -- that restriction is the period character, not a gap to
 * fill. Saturations sit below the reference hexes (which run 60-100%,
 * appropriate for print, not for a screen covered edge-to-edge in polygons).
 *
 * Order is not meaningful beyond matching the brief that chose these pairs;
 * a family's *index* is what the co-visibility graph colours against, same
 * role `TIER1_HUES`'s hue index played before.
 */
const FAMILIES: ReadonlyArray<{ readonly hue: number; readonly saturation: number }> = [
  { hue: 0, saturation: 50 },
  { hue: 22, saturation: 30 },
  { hue: 25, saturation: 50 },
  { hue: 40, saturation: 55 },
  { hue: 45, saturation: 50 },
  { hue: 60, saturation: 34 },
  { hue: 90, saturation: 34 },
  { hue: 150, saturation: 26 },
  { hue: 180, saturation: 26 },
  { hue: 200, saturation: 26 },
];

/** Lightness ladder, lightest first. Shared by every family. */
const SHADE_LIGHTNESS: readonly number[] = [74, 58, 42, 28];

const FAMILY_COUNT = FAMILIES.length;
const SHADE_COUNT = SHADE_LIGHTNESS.length;

/**
 * Sized the same way decision 0016 sized `TIER1_COLOUR_COUNT`, re-measured
 * for this graph now that aggregates are folded into it: the real
 * co-visibility graph (sprawling polities and aggregates together, margin
 * widened) has max degree 97, median 35, and needs 36 of these against the
 * real dist/ (see the report this shipped with) -- denser than decision
 * 0016's own graph (max degree 91, needing 34) because aggregates add nodes
 * and edges the old sprawl-only graph never had. 40 still leaves headroom
 * past that for a denser re-blessed dataset or a wider margin, without
 * silently wrapping. `warnOnOverflow` is what makes exceeding it observable
 * instead of a silent wrong answer, unchanged from decision 0016.
 */
const COLOUR_COUNT = FAMILY_COUNT * SHADE_COUNT;

export interface Palette {
  colourFor(polityId: string): string;
  /**
   * A member's declined colour: a shade of `aggregatePolityId`'s family,
   * chosen deterministically for `memberPolityId` (see `buildPalette`'s
   * `memberShadeOf`). Never the same computation as `colourFor` -- a member
   * does not have an independent graph-coloured or hashed colour of its own
   * to fall back to; this method is the only source of one for it. Callers
   * (`colourForDraw`) already know `aggregatePolityId` is a real polity in
   * this artifact before calling this -- see decision 0017's dangling-name
   * discussion for why that check has to happen at the call site, not here.
   */
  colourForMember(aggregatePolityId: string, memberPolityId: string): string;
}

/** FNV-1a. Any stable hash works; this one is short and has no dependencies. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function familyShadeColour(familyIndex: number, shadeIndex: number): string {
  const family = FAMILIES[familyIndex] as { hue: number; saturation: number };
  const lightness = SHADE_LIGHTNESS[shadeIndex] as number;
  return `hsl(${family.hue} ${family.saturation}% ${lightness}%)`;
}

/**
 * Decomposes a graph-colouring index into a family/shade pair. Modulo guards
 * `colourFor`/`colourForMember`'s total-function contract if the real
 * co-visibility graph ever needs more than `COLOUR_COUNT` colours -- see
 * `warnOnOverflow`, which is what makes that case observable instead of a
 * silent wrong answer.
 */
function colourFromIndex(colourIndex: number): string {
  const i = colourIndex % COLOUR_COUNT;
  return familyShadeColour(i % FAMILY_COUNT, Math.floor(i / FAMILY_COUNT));
}

function familyIndexFromColourIndex(colourIndex: number): number {
  return (colourIndex % COLOUR_COUNT) % FAMILY_COUNT;
}

function hashColour(polityId: string): string {
  return colourFromIndex(hash(polityId) % COLOUR_COUNT);
}

/**
 * Approximates a version's longitude span from its stored bounding box (scaled
 * projected [minX, minY, maxX, maxY]), rather than sweeping every vertex of
 * every polygon. Equal Earth is not a linear function of longitude alone --
 * the same delta-longitude projects to a narrower x the further from the
 * equator -- so both corners are unprojected at the box's own vertical
 * midpoint rather than assuming the equator, and the result is clamped to 360
 * (a span cannot exceed going all the way around).
 *
 * This is an approximation, not the true angular extent of the polygon: a
 * version whose polygons were cut at the antimeridian (decision 0012) can
 * have a bounding box that spans almost the full map width even when the
 * underlying shape's real extent is much narrower, because the cut pieces sit
 * near both edges. That overstates span rather than understating it, which
 * only risks placing a few extra polities into the sprawl-guarantee pool -- a
 * wasted reservation slot, not a broken guarantee, and one bounded by
 * `COLOUR_COUNT` (see `colourFromIndex`).
 */
function lonSpanDegrees(
  bbox: readonly [number, number, number, number],
  coordScale: number,
): number {
  const [minX, minY, maxX, maxY] = bbox;
  const yMid = (minY + maxY) / 2 / coordScale;
  const [lon1] = equalEarthInverse(minX / coordScale, yMid);
  const [lon2] = equalEarthInverse(maxX / coordScale, yMid);
  return Math.min(Math.abs(lon2 - lon1), 360);
}

/** Sorted by fromYear ascending, which is all `intervalsOverlap` requires. */
function toIntervals(versions: readonly Version[]): Array<[number, number]> {
  return versions.map((v): [number, number] => [v.fromYear, v.toYear]).sort((a, b) => a[0] - b[0]);
}

/**
 * Two-pointer sweep over both interval lists, each individually sorted by
 * start. Each interval's *end* (never its start -- a claim's fade-in begins
 * exactly at fromYear, per decision 0001, not before) is treated as extended
 * by `CO_VISIBILITY_MARGIN_YEARS` for this comparison, so a claim ending
 * right where another begins still counts as co-visible through the
 * crossfade between them. Correct for existence-only overlap even if a
 * single candidate's own intervals overlap each other (a data-quality case
 * this does not rule out): whichever interval has the smaller
 * (margin-extended) end is safe to discard permanently once it fails to
 * overlap the other list's current interval, because every later interval in
 * that other list starts no earlier, by construction.
 */
function intervalsOverlap(a: readonly [number, number][], b: readonly [number, number][]): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [aFrom, aTo] = a[i] as [number, number];
    const [bFrom, bTo] = b[j] as [number, number];
    if (aFrom <= bTo + CO_VISIBILITY_MARGIN_YEARS && bFrom <= aTo + CO_VISIBILITY_MARGIN_YEARS) {
      return true;
    }
    if (aTo < bTo) i++;
    else j++;
  }
  return false;
}

/**
 * Adjacency among co-visibility candidates only (sprawling polities and
 * aggregates -- see `buildPalette`): two are adjacent if any interval of one
 * overlaps in years (within `CO_VISIBILITY_MARGIN_YEARS`) with any interval
 * of the other. Built over the candidate set only, not every polity in the
 * artifact, which is what keeps this cheap enough to run at load time in a
 * browser.
 */
function buildCovisibilityGraph(
  candidates: readonly string[],
  intervalsById: ReadonlyMap<string, Array<[number, number]>>,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>(candidates.map((id) => [id, new Set<string>()]));
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i] as string;
    const aIntervals = intervalsById.get(a) as Array<[number, number]>;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j] as string;
      const bIntervals = intervalsById.get(b) as Array<[number, number]>;
      if (intervalsOverlap(aIntervals, bIntervals)) {
        (adjacency.get(a) as Set<string>).add(b);
        (adjacency.get(b) as Set<string>).add(a);
      }
    }
  }
  return adjacency;
}

/**
 * Greedy graph colouring: visit nodes by descending degree (the hardest to
 * place first), breaking ties on id so the result is deterministic, and give
 * each one the smallest colour index none of its already-coloured neighbours
 * holds. Unchanged from decision 0016.
 */
function greedyColour(adjacency: ReadonlyMap<string, Set<string>>): Map<string, number> {
  const order = [...adjacency.keys()].sort((a, b) => {
    const degreeDiff =
      (adjacency.get(b) as Set<string>).size - (adjacency.get(a) as Set<string>).size;
    if (degreeDiff !== 0) return degreeDiff;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const colourOf = new Map<string, number>();
  for (const id of order) {
    const used = new Set<number>();
    for (const neighbour of adjacency.get(id) as Set<string>) {
      const c = colourOf.get(neighbour);
      if (c !== undefined) used.add(c);
    }
    let c = 0;
    while (used.has(c)) c++;
    colourOf.set(id, c);
  }
  return colourOf;
}

/**
 * `colourFromIndex`'s modulo means an overflow -- more colour indices than
 * `COLOUR_COUNT` reserves -- degrades into a silent, wrong answer: two
 * adjacent candidates whose indices happen to differ by exactly the reserved
 * count would collide, breaking the one guarantee this palette exists to
 * make, with nothing on screen to say so. This warns once per `buildPalette`
 * call so that failure is at least loud. Not expected against real data (see
 * the report this shipped with) but a future increase to
 * `CO_VISIBILITY_MARGIN_YEARS`, or a denser re-blessed dataset, could reach
 * it -- and folding aggregates into this same graph (new in this revision)
 * makes it somewhat denser than decision 0016 ever measured, which is
 * exactly why this check still matters.
 */
function warnOnOverflow(colourIndexOf: ReadonlyMap<string, number>): void {
  let overflowCount = 0;
  let maxIndex = -1;
  for (const index of colourIndexOf.values()) {
    if (index > maxIndex) maxIndex = index;
    if (index >= COLOUR_COUNT) overflowCount++;
  }
  if (overflowCount > 0) {
    console.warn(
      `palette: co-visibility graph needed ${maxIndex + 1} colours, ` +
        `more than the ${COLOUR_COUNT} reserved -- ${overflowCount} ` +
        "candidates wrapped via modulo and may collide with a co-visible neighbour.",
    );
  }
}

/**
 * Builds a colour lookup from the dataset itself: which polities are
 * "sprawling", which are aggregates, their graph-coloured assignments, and
 * every aggregate's member shades all depend on every version in this
 * artifact, not just the id being coloured. The hash fallback stays a pure
 * function of the id alone.
 */
export function buildPalette(versions: VersionsArtifact): Palette {
  const versionsByPolity = new Map<string, Version[]>();
  for (const row of versions.rows) {
    const list = versionsByPolity.get(row.polityId) ?? [];
    list.push(row);
    versionsByPolity.set(row.polityId, list);
  }

  // Every polity ever named by another version's memberOf. `memberVersionsOf`
  // collects the actual member rows recorded under each aggregate's name --
  // needed both to widen the aggregate's own co-visibility interval (a
  // metropole-only aggregate is "live" for as long as any of its members are
  // drawn, not just while its own version is) and to enumerate its distinct
  // members for shade cycling below.
  const memberVersionsOf = new Map<string, Version[]>();
  for (const row of versions.rows) {
    if (row.memberOf === null) continue;
    const list = memberVersionsOf.get(row.memberOf) ?? [];
    list.push(row);
    memberVersionsOf.set(row.memberOf, list);
  }
  const aggregateIds = [...memberVersionsOf.keys()];

  // Candidates for the shared co-visibility graph: every aggregate (forced
  // in regardless of its own bounding box -- see the module doc comment) plus
  // every other polity whose own versions sprawl past the threshold.
  // Aggregates are excluded from the plain sprawl scan below and handled with
  // their own (own-versions union member-versions) interval instead, so an
  // aggregate never enters this loop twice under two different interval sets.
  const candidateIntervals = new Map<string, Array<[number, number]>>();
  const candidateIds: string[] = [];

  for (const aggregateId of aggregateIds) {
    const ownRows = versionsByPolity.get(aggregateId) ?? [];
    const memberRows = memberVersionsOf.get(aggregateId) ?? [];
    candidateIntervals.set(aggregateId, toIntervals([...ownRows, ...memberRows]));
    candidateIds.push(aggregateId);
  }

  const aggregateIdSet = new Set(aggregateIds);
  for (const [polityId, polityVersions] of versionsByPolity) {
    if (aggregateIdSet.has(polityId)) continue;
    let sprawling = false;
    for (const v of polityVersions) {
      const bbox = versions.geometry[v.id]?.bbox;
      if (bbox && lonSpanDegrees(bbox, versions.coordScale) > SPRAWL_THRESHOLD_DEGREES) {
        sprawling = true;
        break;
      }
    }
    if (sprawling) {
      candidateIds.push(polityId);
      candidateIntervals.set(polityId, toIntervals(polityVersions));
    }
  }

  const adjacency = buildCovisibilityGraph(candidateIds, candidateIntervals);
  const colourIndexOf = greedyColour(adjacency);
  warnOnOverflow(colourIndexOf);

  const graphColours = new Map<string, string>();
  for (const [id, colourIndex] of colourIndexOf) {
    graphColours.set(id, colourFromIndex(colourIndex));
  }

  const familyOfAggregate = new Map<string, number>();
  for (const aggregateId of aggregateIds) {
    const colourIndex = colourIndexOf.get(aggregateId) as number;
    familyOfAggregate.set(aggregateId, familyIndexFromColourIndex(colourIndex));
  }

  // Each aggregate's distinct members, sorted for a deterministic cycle
  // position. Shade repeats inside one empire past the 4th member are
  // expected and acceptable, not a bug to fix: the shared hue already says
  // "same empire," and the ordinary per-polity outline (canvas.ts) separates
  // any two neighbours that land on the same shade. Median empire-year in
  // the real data has 2 members and the max is 20, so most empires never
  // reach a repeat at all.
  const memberShadeOf = new Map<string, Map<string, number>>();
  for (const aggregateId of aggregateIds) {
    const distinctMembers = [
      ...new Set((memberVersionsOf.get(aggregateId) ?? []).map((v) => v.polityId)),
    ];
    distinctMembers.sort();
    const shadeOf = new Map<string, number>();
    distinctMembers.forEach((memberId, index) => {
      shadeOf.set(memberId, index % SHADE_COUNT);
    });
    memberShadeOf.set(aggregateId, shadeOf);
  }

  return {
    colourFor(polityId: string): string {
      return graphColours.get(polityId) ?? hashColour(polityId);
    },
    colourForMember(aggregatePolityId: string, memberPolityId: string): string {
      const family = familyOfAggregate.get(aggregatePolityId);
      if (family === undefined) {
        // Defensive only: every memberOf value observed above is guaranteed
        // a family, since aggregateIds is built from exactly the same rows.
        // Kept so this method stays total rather than throwing if that
        // invariant is ever violated by a future caller.
        return hashColour(memberPolityId);
      }
      const shade = memberShadeOf.get(aggregatePolityId)?.get(memberPolityId) ?? 0;
      return familyShadeColour(family, shade);
    },
  };
}
