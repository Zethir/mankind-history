import type { Version, VersionsArtifact } from "@history/model";
import { equalEarthInverse } from "@history/model";
import { FADE_SECONDS, SPEED_STEPS } from "../engine/constants";

/**
 * Two tiers, separated by saturation, not by hue count.
 *
 * The Milestone 1 feel session reported colour as meaningless: distant,
 * unrelated polities sharing a colour read as one having invaded the other, or
 * as a colonial claim the map never actually shows. The first fix tried
 * (decision 0016, original text) seeded hue from longitude so a repeated
 * colour would land on a geographic neighbour instead of a random polity
 * anywhere on Earth. Measured against the real dist/ (1,583 polities, 13,380
 * versions), that made the reported problem WORSE, not better: same-colour
 * pairs simultaneously on screen overlapped in longitude 15.8% of the time
 * under the original hash palette, and 65.9% of the time under geographic hue
 * -- within 20 degrees of each other 94.8% of the time. Ranking every polity
 * on Earth into 12 longitude bands packs each band with whatever happens to
 * sit at that longitude, which is exactly the polities most likely to be
 * on-screen together and therefore most likely to need telling apart. See
 * decision 0016 for the full measurement and the argument against Phase 0's
 * "fewer hues, more lightness" fallback, which this design also departs from.
 *
 * What actually distinguishes the map's confusions is not "any two polities
 * anywhere" but a much smaller, much more visible set: polities whose
 * territory itself sprawls across the map -- colonial empires, federations,
 * anything that reads on screen as scattered pieces rather than one blob.
 * Those are the ones a repeated colour genuinely misleads about (Portugal's
 * scattered holdings landing on France's colour looks like an invasion),
 * and there are few enough of them (136 in the real data, under this
 * implementation's bbox-based approximation of "sprawls"; at most 29 ever on
 * screen at once, in 1905) to give each one, among its actual on-screen
 * contemporaries, a colour no other sprawling polity shares -- a guarantee
 * decision 0016 could not make for 1,583 polities but can make for 136.
 *
 * That guarantee has to cover more than the instant two empires are both on
 * screen: `alphaFor` (`engine/fade.ts`) keeps drawing a version through its
 * crossfade tail, `fadeYears` after `toYear + 1`, so two empires whose
 * claimed intervals merely *abut* -- one ending the year the other begins,
 * the common shape of a succession -- are genuinely on screen together for
 * that fade. `CO_VISIBILITY_MARGIN_YEARS` below widens the co-visibility test
 * by that margin, so a colour never repeats across a dissolve either; without
 * it, measured against the real dist/, 39 sprawling pairs within 2 years of
 * each other resolved to the identical colour, most of them exactly the
 * successor-state pairs this margin exists to protect (a British Empire /
 * Commonwealth of Nations transition one year apart, both unmargined-graph
 * non-adjacent, is the canonical example).
 *
 * Tier 1 -- sprawling polities (136 of 1,583, measured against the real
 * dist/): a graph-coloured set of 40 saturated colours, guaranteeing that no
 * two sprawling polities ever on screen together -- including during a
 * crossfade between them -- share a colour. See `SPRAWL_THRESHOLD_DEGREES`,
 * `CO_VISIBILITY_MARGIN_YEARS` and `buildCovisibilityGraph` below for the
 * qualification rule, the margin, and the colouring itself.
 *
 * Tier 2 -- everything else (roughly 1,447 of 1,583): a muted, desaturated
 * palette assigned by the FNV-1a hash of the polity id, same approach as the
 * original palette, now at 36 colours (up from the previous cut's 24). This
 * tier carries most of the screen -- 174 of the busiest year's 195 polities,
 * 2014 -- so its density matters even though no per-pair guarantee is made
 * for it: at 36 colours, mean 4.83 polities per colour there (worst 10),
 * better than both the 24-colour cut it replaces (mean 7.25, worst 13) and
 * the originally shipped palette's 32 (mean 5.44, worst 11). No graph
 * colouring here: proximity-graph colouring was measured to roughly halve
 * local same-colour overlap for this tier (16.1% down to 8.7%), but needs a
 * load-time computation (a spatial proximity graph over ~1,450 polities and
 * their full version geometry, not just ~136 ids and their bounding boxes)
 * expensive enough to defer. See decision 0016.
 *
 * The two tiers are told apart by saturation alone (tier 1 62%, tier 2 26%),
 * so a sprawling empire never reads as just another local polity even where
 * their hues coincide. Minimum CIE76 deltaE, computed against these exact
 * constants: 15.98 within tier 1, 9.14 within tier 2 -- both above the
 * shipped palette's 8.29, and tier 1's is comfortably above the
 * geographic-hue attempt's 12.9. See decision 0016 for the script and the
 * full grid search.
 */

/** Degrees of longitude a polity's widest version must span to be tier 1. */
const SPRAWL_THRESHOLD_DEGREES = 45;

/**
 * How many years past a claimed interval's end two sprawling polities still
 * count as co-visible, because the renderer keeps drawing a fading-out
 * version past `toYear`. Derived from the engine's own constants rather than
 * chosen as a magic number: `FADE_SECONDS * max(SPEED_STEPS)` is
 * 0.4 * 16 = 6.4 years, the longest fade the fixed speed steps ever produce.
 * `Math.ceil` takes that to 7, and one more year of headroom takes it to 8,
 * because Auto mode's adaptive speed (`engine/clock.ts`) can transiently
 * exceed the fixed steps while accelerating toward a distant change --
 * though only while crossing a gap where, by construction, nothing is
 * visibly changing, so this is a safety margin on top of the real worst case
 * rather than a correction to it.
 */
const CO_VISIBILITY_MARGIN_YEARS = Math.ceil(FADE_SECONDS * Math.max(...SPEED_STEPS)) + 1;

/**
 * 10 hues x 4 lightness bands = 40 colours. Sized against the real
 * co-visibility graph *with* `CO_VISIBILITY_MARGIN_YEARS` applied: max degree
 * 91, median 35, needing 34 colours to greedy-colour with zero conflicts (a
 * 0-year margin needs only 30, but that is the guarantee without the fade
 * tail this margin exists to close). 40 leaves headroom up to a 16-year
 * margin (which needs 38) rather than sitting exactly at the measured
 * minimum -- 34 reserved colours worked for today's data, but had zero slack
 * for a slightly denser re-blessed dataset or a slightly wider margin, and
 * `tier1Colour`'s modulo fallback means running out silently produces a
 * wrong answer, not a crash. See `warnOnOverflow` for what happens if 40
 * ever turns out not to be enough either.
 */
const TIER1_HUES = 10;
const TIER1_SATURATION = 62;
const TIER1_LIGHTNESS = [74, 50, 38, 26];
const TIER1_COLOUR_COUNT = TIER1_HUES * TIER1_LIGHTNESS.length;

/**
 * 12 hues x 3 lightness bands = 36 colours (up from 24), hash-assigned,
 * desaturated so it reads as "not an empire". Widened because this tier
 * carries most of the screen at any density -- see the module doc comment
 * for the measured before/after.
 */
const TIER2_HUES = 12;
const TIER2_SATURATION = 26;
const TIER2_LIGHTNESS = [60, 48, 38];

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

function tier1Colour(colourIndex: number): string {
  // Modulo guards colourFor's total-function contract if the real
  // co-visibility graph ever needed more than TIER1_COLOUR_COUNT colours --
  // it has not, against the real dist/ (see the report this shipped with),
  // but colourFor must still return a string rather than throw if a future
  // dataset's graph is denser than today's. `warnOnOverflow` is what makes
  // that case observable instead of a silent wrong answer.
  const i = colourIndex % TIER1_COLOUR_COUNT;
  const hueIndex = i % TIER1_HUES;
  const lightnessIndex = Math.floor(i / TIER1_HUES);
  const hue = (hueIndex * 360) / TIER1_HUES;
  const lightness = TIER1_LIGHTNESS[lightnessIndex] as number;
  return `hsl(${hue} ${TIER1_SATURATION}% ${lightness}%)`;
}

function tier2Colour(polityId: string): string {
  const h = hash(polityId);
  const hueIndex = h % TIER2_HUES;
  const lightnessIndex = Math.floor(h / TIER2_HUES) % TIER2_LIGHTNESS.length;
  const hue = (hueIndex * 360) / TIER2_HUES;
  const lightness = TIER2_LIGHTNESS[lightnessIndex] as number;
  return `hsl(${hue} ${TIER2_SATURATION}% ${lightness}%)`;
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
 * only risks placing a few extra polities into tier 1 -- a wasted reservation
 * slot, not a broken guarantee, and one bounded by TIER1_COLOUR_COUNT (see
 * `tier1Colour`).
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
 * crossfade between them (see the module doc comment). Correct for
 * existence-only overlap even if a single polity's own versions overlap each
 * other in time (a data-quality case this does not rule out): whichever
 * interval has the smaller (margin-extended) end is safe to discard
 * permanently once it fails to overlap the other list's current interval,
 * because every later interval in that other list starts no earlier, by
 * construction -- the margin is constant and applied the same way to both
 * lists, so it does not disturb that proof.
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
 * Adjacency among sprawling polities only: two are adjacent if any version of
 * one overlaps in years (within `CO_VISIBILITY_MARGIN_YEARS`) with any
 * version of the other. Built over 136 polities in the real data, not all
 * 1,583 and not all 5,424 years, which is what keeps this cheap enough to run
 * at load time in a browser.
 */
function buildCovisibilityGraph(
  sprawlers: readonly string[],
  intervalsByPolity: ReadonlyMap<string, Array<[number, number]>>,
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>(sprawlers.map((id) => [id, new Set<string>()]));
  for (let i = 0; i < sprawlers.length; i++) {
    const a = sprawlers[i] as string;
    const aIntervals = intervalsByPolity.get(a) as Array<[number, number]>;
    for (let j = i + 1; j < sprawlers.length; j++) {
      const b = sprawlers[j] as string;
      const bIntervals = intervalsByPolity.get(b) as Array<[number, number]>;
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
 * place first), breaking ties on polity id so the result is deterministic,
 * and give each one the smallest colour index none of its already-coloured
 * neighbours holds. This is the ordering the measurement in decision 0016 was
 * run against -- against the margin-widened real co-visibility graph (max
 * degree 91, median 35) it needs at most 34 colours, not 40 in general and
 * not for greedy colouring in general.
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
 * `tier1Colour`'s modulo means an overflow -- more colour indices than
 * `TIER1_COLOUR_COUNT` reserves -- degrades into a silent, wrong answer: two
 * adjacent polities whose indices happen to differ by exactly the reserved
 * count would collide, breaking the one guarantee this palette exists to
 * make, with nothing on screen to say so. This warns once per `buildPalette`
 * call so that failure is at least loud: a guarantee that fails silently is
 * worse than one that fails loudly. Not expected against real data -- see the
 * report this shipped with -- but a re-blessed dataset with denser sprawl, or
 * a future increase to `CO_VISIBILITY_MARGIN_YEARS`, could reach it.
 */
function warnOnOverflow(colourIndexOf: ReadonlyMap<string, number>): void {
  let overflowCount = 0;
  let maxIndex = -1;
  for (const index of colourIndexOf.values()) {
    if (index > maxIndex) maxIndex = index;
    if (index >= TIER1_COLOUR_COUNT) overflowCount++;
  }
  if (overflowCount > 0) {
    console.warn(
      `palette: tier-1 co-visibility graph needed ${maxIndex + 1} colours, ` +
        `more than the ${TIER1_COLOUR_COUNT} reserved -- ${overflowCount} ` +
        "polities wrapped via modulo and may collide with a co-visible neighbour.",
    );
  }
}

/**
 * Builds a colour lookup from the dataset itself: which polities qualify as
 * tier 1, and their tier-1 colour assignment, both depend on every polity's
 * versions in this artifact, not just the id being coloured. Tier 2 stays a
 * pure function of the id alone.
 *
 * For each polity, qualifies for tier 1 if any of its versions' bounding
 * boxes spans more than `SPRAWL_THRESHOLD_DEGREES` of longitude (see
 * `lonSpanDegrees`). Tier-1 polities are graph-coloured against each other by
 * year co-visibility (see `buildCovisibilityGraph` and `greedyColour`);
 * everyone else gets a hash-derived tier-2 colour.
 */
export function buildPalette(versions: VersionsArtifact): Palette {
  const versionsByPolity = new Map<string, Version[]>();
  for (const row of versions.rows) {
    const list = versionsByPolity.get(row.polityId) ?? [];
    list.push(row);
    versionsByPolity.set(row.polityId, list);
  }

  const sprawlers: string[] = [];
  const intervalsByPolity = new Map<string, Array<[number, number]>>();
  for (const [polityId, polityVersions] of versionsByPolity) {
    let sprawling = false;
    for (const v of polityVersions) {
      const bbox = versions.geometry[v.id]?.bbox;
      if (bbox && lonSpanDegrees(bbox, versions.coordScale) > SPRAWL_THRESHOLD_DEGREES) {
        sprawling = true;
        break;
      }
    }
    if (sprawling) {
      sprawlers.push(polityId);
      intervalsByPolity.set(polityId, toIntervals(polityVersions));
    }
  }

  const adjacency = buildCovisibilityGraph(sprawlers, intervalsByPolity);
  const colourIndexOf = greedyColour(adjacency);
  warnOnOverflow(colourIndexOf);

  const tier1Colours = new Map<string, string>();
  for (const [polityId, colourIndex] of colourIndexOf) {
    tier1Colours.set(polityId, tier1Colour(colourIndex));
  }

  return {
    colourFor(polityId: string): string {
      return tier1Colours.get(polityId) ?? tier2Colour(polityId);
    },
  };
}
