import type { Version, VersionsArtifact } from "@history/model";
import { equalEarthInverse } from "@history/model";
import { FADE_SECONDS, SPEED_STEPS } from "../engine/constants";

/**
 * One family palette, not two saturation tiers, and one colour per polity --
 * no declination.
 *
 * The graph this module colours against unions two kinds of edges (see
 * `buildPalette`): co-visibility (two candidates coexist in time, the
 * original decision-0016 mechanism) and, as of this revision, spatial
 * proximity (two drawn identities' territory overlaps on screen in some year
 * they are both live). The owner's complaint that motivated the proximity
 * half: "I think we should not have the same color on different polities
 * that are touching or close, I think it's disturbing." Measured against the
 * real dist/: adding proximity edges drops neighbouring-pair colour
 * collisions from 155 (2.33% of neighbouring pairs) to 0, using the same 40
 * colours -- see `buildProximityGraph` and the report this shipped with.
 * Expanding the palette to chase this instead was measured and rejected:
 * see `FAMILIES`'s comment and docs/decisions/0016-two-tier-sprawl-palette.md.
 *
 * Decision 0016 split the palette into a saturated "tier 1" (sprawling
 * empires, graph-coloured for a hard no-collision guarantee) and a muted
 * "tier 2" (everyone else, hash-assigned), told apart by saturation alone so
 * an empire could never read as just another local polity. Decision 0018
 * replaced the two saturation tiers with one shared 40-colour, 1970s-styled
 * space (kept below, unchanged) and, in the same revision, tried having an
 * empire's *members* render as shades of the aggregate's family
 * ("declination"). That second part is reverted here: see
 * docs/decisions/0019-merged-fill-with-boundary.md for why -- in short, the
 * owner watched it on the map and reported
 * that two adjacent empires' shade families read as mush, and reverting also
 * happens to remove a real defect (declination let a member's colour skip
 * the sprawl-guarantee graph entirely, producing 49 real on-screen
 * collisions against the real dist/; see the report this shipped with for
 * the post-revert count).
 *
 * The palette itself: 10 hue families (hue/saturation pairs chosen for 1970s
 * character -- warm earths at higher saturation, greens and teals muted, no
 * blues or magentas) x 4 lightness shades = 40 colours total.
 *
 * Two populations draw from this one space, exactly as decision 0016 always
 * did:
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
 *    co-visible sprawling neighbour shares. A member polity that
 *    independently qualifies as sprawling (a colonial territory whose own
 *    bounding box spans continents) is *not* excluded from this population --
 *    it competes for, and holds, its own graph-coloured slot like any other
 *    sprawling candidate, which is exactly the guarantee declination used to
 *    override.
 *
 * 2. Everyone else -- compact, unaffiliated polities, and any member that
 *    does not independently qualify as sprawling -- is hash-assigned into the
 *    same 40-colour space.
 *
 * `colourFor` is the only lookup either population needs. What a *member's*
 * version actually renders as (its own `colourFor` result, or its
 * aggregate's, for the merged fill) is a rendering choice made in
 * render-mode.ts, not a fact this module computes -- this module only ever
 * assigns one colour per polity.
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
 * a family's *index* is what the graph colours against, same role
 * `TIER1_HUES`'s hue index played before.
 *
 * Do not grow this to fix a neighbouring-colour complaint. That was measured
 * and rejected: 40 colours give a cross-family minimum CIE76 deltaE of 11.9;
 * pushing to 72 collapses that to 6.0 with 22 confusable pairs, because past
 * roughly 40 colours people stop being able to tell them apart regardless of
 * how they are assigned (see decision 0016's "What the data says the actual
 * problem is"). The fix for two touching polities sharing a colour is
 * spending these 40 colours better -- folding spatial proximity into the
 * graph `buildPalette` colours against, below -- not adding more of them.
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
 * each time the graph this module colours against grew: 36 against the
 * co-visibility-only graph with aggregates folded in (decision 0018), and as
 * of this revision, 35 against the *combined* co-visibility/proximity graph
 * (max proximity degree ~580, median ~10, over ~1,350 nodes -- most of them
 * ordinary compact polities with a touching neighbour, not sprawling
 * empires) -- see the report this shipped with. That the combined graph
 * needs *fewer* colours than the co-visibility-only graph once did is not a
 * contradiction: proximity edges mostly connect small, low-degree compact
 * polities that were previously unconstrained (hash-assigned) and easy for
 * greedy colouring to slot in, while the union only ever adds constraints,
 * never removes the sprawling-empire ones decision 0016/0018 measured. 40
 * still leaves headroom past 35 for a denser re-blessed dataset, a wider
 * margin, or a stricter proximity test, without silently wrapping.
 * `warnOnOverflow` is what makes exceeding it observable instead of a silent
 * wrong answer, unchanged in mechanism from decision 0016.
 */
const COLOUR_COUNT = FAMILY_COUNT * SHADE_COUNT;

export interface Palette {
  colourFor(polityId: string): string;
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
 * `colourFor`'s total-function contract if the real co-visibility graph ever
 * needs more than `COLOUR_COUNT` colours -- see `warnOnOverflow`, which is
 * what makes that case observable instead of a silent wrong answer.
 */
function colourFromIndex(colourIndex: number): string {
  const i = colourIndex % COLOUR_COUNT;
  return familyShadeColour(i % FAMILY_COUNT, Math.floor(i / FAMILY_COUNT));
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
 * True if two scaled-integer projected bounding boxes overlap in both axes.
 *
 * This is a loose proxy for true adjacency, deliberately: it reports two
 * territories as neighbours whenever their *rectangles* touch, even where
 * the actual polygons inside those rectangles do not (a near-miss on the
 * diagonal, or two coastlines facing each other across open water). That
 * makes the proximity graph *more* constrained than reality -- it can demand
 * distinct colours for a pair that never actually touches -- so a
 * conflict-free colouring built against it is conservative, not optimistic.
 * Do not replace this with a tighter or "smarter" test (bbox centres, a
 * distance threshold, true polygon adjacency) thinking it is an improvement:
 * loosening the test would let some real touching pairs through uncaught,
 * which is exactly the defect this graph exists to close. A false positive
 * here only costs a wasted colour-distinctness constraint; a false negative
 * would put the same colour back on two touching polities.
 */
function bboxesOverlap(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** One version's drawn identity, year interval and bounding box, for the proximity sweep. */
interface ProximityRecord {
  readonly drawnId: string;
  readonly fromYear: number;
  readonly toYear: number;
  readonly bbox: readonly [number, number, number, number];
}

/**
 * Adjacency by spatial proximity: two *drawn identities* (`memberOf ??
 * polityId` -- colour is assigned to the aggregate a member renders as, per
 * decision 0019's merged fill, so two members of the same empire must never
 * be forced apart by this graph even though their boxes overlap) are
 * adjacent if, in some year both have a live version, those versions'
 * bounding boxes overlap in both axes (`bboxesOverlap`).
 *
 * This is the second half of the fix for the owner's report: "I think we
 * should not have the same color on different polities that are touching or
 * close, I think it's disturbing." Unlike `buildCovisibilityGraph`, which
 * only ever considers the ~150 sprawling/aggregate candidates, this must
 * consider every polity in the artifact -- most on-screen collisions are
 * between two perfectly ordinary, compact, adjacent polities, not empires.
 *
 * A naive sweep would test every pair of live versions in every one of the
 * dataset's 5,424 years -- up to 195 live versions squared, per year, far
 * too slow to run at page load in a browser. Instead of sampling years (a
 * legitimate alternative -- the measurement that motivated this fix sampled
 * 120 years and still found the fix effective), this sweeps exactly the
 * "breakpoints" where the live set can change (every version's `fromYear`
 * and `toYear + 1`, deduplicated and sorted -- a few hundred against the
 * real dist/, not thousands) so no transient overlap between two breakpoints
 * can be missed, and no year is ever visited whose live set is identical to
 * the one before it. Within each breakpoint-to-breakpoint segment, the live
 * set is sorted by `minX` and swept left to right with an `open` list of
 * records still possibly overlapping in x (evicting any whose `maxX` has
 * already fallen behind, which is safe once `minX` only increases): only
 * pairs that pass the x-overlap prune are ever bbox-tested for y, which is
 * what keeps the busiest real segments (up to 195 live versions) fast in
 * practice even though the graph's median degree (10) says most pairs never
 * overlap at all. Measured against the real dist/: ~50ms total, see the
 * report this shipped with.
 */
function buildProximityGraph(versions: VersionsArtifact): Map<string, Set<string>> {
  const records: ProximityRecord[] = [];
  for (const row of versions.rows) {
    const bbox = versions.geometry[row.id]?.bbox;
    if (!bbox) continue;
    records.push({
      drawnId: row.memberOf ?? row.polityId,
      fromYear: row.fromYear,
      toYear: row.toYear,
      bbox,
    });
  }

  const breakpoints = [...new Set(records.flatMap((r) => [r.fromYear, r.toYear + 1]))].sort(
    (x, y) => x - y,
  );
  const byStart = [...records].sort((a, b) => a.fromYear - b.fromYear);
  const byEnd = [...records].sort((a, b) => a.toYear - b.toYear);

  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string): void => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set<string>());
    if (!adjacency.has(b)) adjacency.set(b, new Set<string>());
    (adjacency.get(a) as Set<string>).add(b);
    (adjacency.get(b) as Set<string>).add(a);
  };

  const active = new Set<ProximityRecord>();
  let startIndex = 0;
  let endIndex = 0;
  for (let bp = 0; bp < breakpoints.length; bp++) {
    const year = breakpoints[bp] as number;
    // Retire records ending strictly before `year` FIRST, so the active set
    // reflects exactly who is live during [year, nextBreakpoint - 1] before
    // either the pair check below or a same-year successor's arrival.
    while (endIndex < byEnd.length && (byEnd[endIndex] as ProximityRecord).toYear + 1 === year) {
      active.delete(byEnd[endIndex] as ProximityRecord);
      endIndex++;
    }
    while (
      startIndex < byStart.length &&
      (byStart[startIndex] as ProximityRecord).fromYear === year
    ) {
      active.add(byStart[startIndex] as ProximityRecord);
      startIndex++;
    }

    if (active.size > 1) {
      const live = [...active].sort((a, b) => a.bbox[0] - b.bbox[0]);
      const open: ProximityRecord[] = [];
      for (const cur of live) {
        let w = 0;
        for (let r = 0; r < open.length; r++) {
          const o = open[r] as ProximityRecord;
          if (o.bbox[2] >= cur.bbox[0]) open[w++] = o;
        }
        open.length = w;
        for (let r = 0; r < open.length; r++) {
          const o = open[r] as ProximityRecord;
          if (o.drawnId !== cur.drawnId && bboxesOverlap(o.bbox, cur.bbox)) {
            connect(o.drawnId, cur.drawnId);
          }
        }
        open.push(cur);
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
 * count would collide, breaking one of the two guarantees this palette
 * exists to make (no two co-visible sprawling empires share a colour, no two
 * on-screen neighbours share a colour), with nothing on screen to say so.
 * This warns once per `buildPalette` call so that failure is at least loud.
 * Not expected against real data (see the report this shipped with -- 35 of
 * 40 needed against the combined co-visibility/proximity graph) but a future
 * increase to `CO_VISIBILITY_MARGIN_YEARS`, or a denser re-blessed dataset,
 * could reach it -- and unioning in the proximity graph (new in this
 * revision) makes this substantially denser than decision 0016 or 0018 ever
 * measured, which is exactly why this check still matters. If this ever
 * fires against real data, that is an overflow to report, not to silence:
 * see the module doc comment on why growing `FAMILIES` is the wrong fix.
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
      `palette: combined co-visibility/proximity graph needed ${maxIndex + 1} ` +
        `colours, more than the ${COLOUR_COUNT} reserved -- ${overflowCount} ` +
        "candidates wrapped via modulo and may collide with a neighbour.",
    );
  }
}

/**
 * Builds a colour lookup from the dataset itself: which polities are
 * "sprawling", which are aggregates, which touch or sit close to which, and
 * their graph-coloured assignments all depend on every version in this
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
  // needed to widen the aggregate's own co-visibility interval: a
  // metropole-only aggregate is "live" for as long as any of its members are
  // drawn, not just while its own version is.
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

  const covisibility = buildCovisibilityGraph(candidateIds, candidateIntervals);
  const proximity = buildProximityGraph(versions);

  // Union the two adjacency graphs: colour is assigned against whichever
  // guarantee -- no two co-visible sprawling empires share a colour, no two
  // on-screen neighbours share a colour -- has an opinion about a given pair.
  // A node that is only ever a proximity candidate (an ordinary compact
  // polity with a touching neighbour, the common case that motivated this
  // graph) still needs its own entry so it competes for a graph-coloured
  // slot instead of falling through to the unconstrained hash fallback.
  const combined = new Map<string, Set<string>>();
  for (const [id, neighbours] of covisibility) {
    combined.set(id, new Set(neighbours));
  }
  for (const [id, neighbours] of proximity) {
    const existing = combined.get(id) ?? new Set<string>();
    for (const neighbour of neighbours) existing.add(neighbour);
    combined.set(id, existing);
  }

  const colourIndexOf = greedyColour(combined);
  warnOnOverflow(colourIndexOf);

  const graphColours = new Map<string, string>();
  for (const [id, colourIndex] of colourIndexOf) {
    graphColours.set(id, colourFromIndex(colourIndex));
  }

  return {
    colourFor(polityId: string): string {
      return graphColours.get(polityId) ?? hashColour(polityId);
    },
  };
}
