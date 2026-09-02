import { hash32 } from './temporal.mjs';

// Chalky pastels on a deep plate. Low chroma keeps it gentle over a long
// viewing session; the dark ground is what lets them read as luminous rather
// than washed out, and leaves headroom above them for the expansion flash.
//
// Sixteen hues, spaced unevenly so that neighbouring polities are unlikely to
// land on adjacent hues. Two lightness bands give a second axis of separation
// when two do collide.

const HUES = [
  8, 22, 38, 52, 78, 100, 130, 152, 172, 190, 208, 228, 258, 285, 320, 345,
];

const SAT = 34;
const LIGHT_A = 71;
const LIGHT_B = 60;

// Where a flash travels to. Well above the base bands, still short of white so
// it reads as illuminated rather than blown out.
const FLASH_LIGHT = 93;
const FLASH_SAT = 22;

export const GROUND = {
  sea: '#141F29',
  land: '#22303C',      // land with no polity: quiet, but never confusable with sea
  graticule: 'rgba(184, 208, 226, 0.055)',
  coast: 'rgba(184, 208, 226, 0.13)',
};

export function colorFor(name) {
  const h = hash32(name);
  const hue = HUES[h % HUES.length];
  const light = (h >>> 8) % 2 === 0 ? LIGHT_A : LIGHT_B;
  return { hue, sat: SAT, light };
}

export function buildPalette(polities) {
  return polities.map((p) => colorFor(p.name));
}

/**
 * Base colour, or a brightened version of it when flashing.
 * @param {number} flash 0..1
 */
export function fillFor(color, flash) {
  if (flash <= 0.001) {
    return `hsl(${color.hue} ${color.sat}% ${color.light}%)`;
  }
  const light = color.light + (FLASH_LIGHT - color.light) * flash;
  const sat = color.sat + (FLASH_SAT - color.sat) * flash;
  return `hsl(${color.hue} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`;
}

export function strokeFor(color) {
  return `hsl(${color.hue} ${color.sat}% ${Math.min(color.light + 16, 88)}%)`;
}
