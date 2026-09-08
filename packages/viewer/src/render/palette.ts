/**
 * Sixteen hues at low saturation on a dark plate, per Phase 0's visual
 * direction. The dark ground is what leaves lightness headroom above the base
 * tones for the expansion flash to travel into; on a light ground the flash
 * would have to invert to a saturation shift, which is far harder to notice
 * peripherally.
 *
 * Phase 0 explicitly did not validate this at real density and recorded the
 * fallback: if neighbours read as the same colour, use FEWER hues with more
 * lightness separation, not more hues. Judging that is part of Milestone 1.
 */
export const PALETTE_HUES = 16;
const SATURATION = 34;
/** Alternating lightness bands, so adjacent hues differ in two dimensions. */
const LIGHTNESS = [62, 52];

/** FNV-1a. Any stable hash works; this one is short and has no dependencies. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Colour is a property of the POLITY, not the version, and is stable for the
 * life of the id. Crossfading between two versions of one polity while its
 * colour shifts would read as one entity being replaced by another -- the
 * false assertion decision 0001 exists to avoid.
 */
export function colourFor(polityId: string): string {
  const h = hash(polityId);
  const hue = ((h % PALETTE_HUES) * 360) / PALETTE_HUES;
  const lightness = LIGHTNESS[Math.floor(h / PALETTE_HUES) % LIGHTNESS.length] as number;
  return `hsl(${hue} ${SATURATION}% ${lightness}%)`;
}
