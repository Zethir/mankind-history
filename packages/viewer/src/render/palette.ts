import type { VersionsArtifact } from "@history/model";

/**
 * Twelve hues, seeded from geography rather than the id's hash, at moderate
 * saturation on a dark plate. Colour still needs lightness headroom above the
 * base tones for the expansion flash to travel into (decision 0003, and Phase
 * 0's visual direction) -- that part is unchanged.
 *
 * What changed, and why: the Milestone 1 feel session reported colour as
 * meaningless -- distant, unrelated polities sharing a colour read as one
 * having invaded the other, or as a colonial claim the map never actually
 * shows. Measured against the real dist/ (1,583 polities, 13,380 versions):
 * the shipped 16-hue/2-lightness palette produced 32 colours, so the busiest
 * year (195 simultaneous polities) had about 6 polities per colour, and
 * same-colour polities sat a median 220 degrees of longitude apart -- almost
 * always the opposite side of the world. Adding more hues makes this worse,
 * not better: 72 colours drops the minimum CIE76 colour distance from 8.3 to
 * 6.0 with 22 confusable pairs, because past roughly 40 colours humans stop
 * being able to tell them apart. "One distinct colour per polity" is
 * unreachable at this density; see decision 0016.
 *
 * The fix is Phase 0's own recorded fallback -- "fewer hues with more
 * lightness separation, not more hues" -- combined with seeding hue from
 * longitude so that a repeated colour lands on a geographic neighbour instead
 * of a random polity anywhere on Earth. 12 hues x 3 lightness bands measured
 * a minimum CIE76 distance of 12.9, and dropped the same-colour longitude
 * spread to a median of 9 degrees. See decision 0016 for the full
 * measurements. This has not been judged by a human watching the map; only
 * the previous palette has been, and it was reported broken.
 */
export const PALETTE_HUES = 12;
const SATURATION = 55;
/** Three lightness bands, so polities adjacent in longitude still separate. */
const LIGHTNESS = [72, 56, 40];

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

function hslFor(polityId: string, hueIndex: number): string {
  const hue = (hueIndex * 360) / PALETTE_HUES;
  const h = hash(polityId);
  const lightness = LIGHTNESS[Math.floor(h / PALETTE_HUES) % LIGHTNESS.length] as number;
  return `hsl(${hue} ${SATURATION}% ${lightness}%)`;
}

/**
 * Used only when a polity cannot be placed geographically: no version could
 * be resolved for it in the artifact `buildPalette` was given, or its
 * earliest version carries no anchor. This should not happen against a
 * well-formed artifact -- every version has a pole-of-inaccessibility anchor
 * -- but `colourFor` still owes every id a colour, so this is the documented
 * fallback path, not the normal one. It hashes hue as well as lightness, so
 * it carries none of the geographic-locality property the rest of the
 * palette is built for.
 */
function fallbackColour(polityId: string): string {
  const hueIndex = hash(polityId) % PALETTE_HUES;
  return hslFor(polityId, hueIndex);
}

/**
 * Builds a colour lookup from the dataset itself, which is why colour is no
 * longer a pure function of the polity id alone (see decision 0016): it also
 * depends on where every OTHER polity in this artifact sits, because hue is
 * assigned by rank.
 *
 * For each polity, takes its earliest version (minimum `fromYear`, ties
 * broken on version id so the choice is deterministic) and reads that
 * version's projected anchor x -- the pole of inaccessibility, already
 * computed at build time for label placement. Polities are sorted by that x
 * ascending (ties broken on polity id), and hue is assigned by rank:
 * `hueIndex = floor(rank / total * PALETTE_HUES)`. Two polities close in
 * longitude land in the same or adjacent hue bands; two polities on opposite
 * sides of the world land in different ones. Lightness is unrelated to
 * position -- a hash of the polity id -- so that polities ranked next to each
 * other, and therefore sharing a hue band, still separate.
 */
export function buildPalette(versions: VersionsArtifact): Palette {
  const earliest = new Map<string, { versionId: string; fromYear: number }>();
  for (const row of versions.rows) {
    const current = earliest.get(row.polityId);
    if (
      !current ||
      row.fromYear < current.fromYear ||
      (row.fromYear === current.fromYear && row.id < current.versionId)
    ) {
      earliest.set(row.polityId, { versionId: row.id, fromYear: row.fromYear });
    }
  }

  const placed: Array<{ polityId: string; x: number }> = [];
  const unplaced: string[] = [];
  for (const [polityId, entry] of earliest) {
    const anchor = versions.geometry[entry.versionId]?.anchor;
    if (anchor) {
      placed.push({ polityId, x: anchor[0] });
    } else {
      unplaced.push(polityId);
    }
  }

  placed.sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x;
    if (a.polityId < b.polityId) return -1;
    if (a.polityId > b.polityId) return 1;
    return 0;
  });

  const colours = new Map<string, string>();
  const total = placed.length;
  placed.forEach(({ polityId }, rank) => {
    const hueIndex = Math.floor((rank / total) * PALETTE_HUES);
    colours.set(polityId, hslFor(polityId, hueIndex));
  });
  for (const polityId of unplaced) {
    colours.set(polityId, fallbackColour(polityId));
  }

  return {
    colourFor(polityId: string): string {
      return colours.get(polityId) ?? fallbackColour(polityId);
    },
  };
}
