// Crossfade is the chosen mode. Hard cut and staggered cut are gone, along with
// the mode selector, the fade-unit toggle and the stagger control.
//
// Every version still gets an alpha for the current (fractional) year, which is
// what makes fractional-year playback work. What is new is `flash`: a separate
// 0..1 signal that brightens a territory as it fades in, but only when the data
// can actually justify it.

export function hash32(value) {
  let h = 0x811c9dc5;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Fade is derived from speed, not configured. Constant wall-clock duration
// keeps the feel identical at 4 yr/s and 40 yr/s, but pure proportionality
// breaks down at high speed: the fade window grows until three states of the
// same polity overlap and the map turns to mush. Hence the clamp.
//
// FADE_SECONDS is the one tuned constant. MAX_FADE_YEARS should be set from
// the real median version duration once the histogram gives you the number.
export const FADE_SECONDS = 0.7;
export const MIN_FADE_YEARS = 1.5;
export const MAX_FADE_YEARS = 15;

export function fadeYearsFor(yearsPerSecond, maxFadeYears = MAX_FADE_YEARS) {
  const raw = FADE_SECONDS * Math.max(yearsPerSecond, 0.01);
  return Math.min(Math.max(raw, MIN_FADE_YEARS), maxFadeYears);
}

// A version may only flash if its growth can be attributed to something.
// A 200-year hole between versions represents two centuries of drift, not an
// event, and flashing it would invent a dramatic moment the data does not
// support. Same failure as morphing, better dressed.
export const MAX_ATTRIBUTABLE_GAP = 50;

// Relative growth needed for a full-strength flash. A small polity doubling
// should read as strongly as an empire gaining a few percent.
const FULL_FLASH_RATIO = 0.5;

export function flashStrengthFor(version) {
  if (version.delta === null || version.delta === undefined) return 0; // first appearance
  if (version.delta <= 0) return 0;                                    // contraction just fades
  if (version.gap > MAX_ATTRIBUTABLE_GAP) return 0;                    // unattributable
  if (!version.prevArea) return 0;
  const ratio = version.delta / version.prevArea;
  return Math.min(1, ratio / FULL_FLASH_RATIO);
}

/**
 * @returns {{alpha:number, flash:number}} flash is 0 outside the fade-in ramp
 */
export function stateFor(version, year, fadeYears) {
  if (year < version.from || year > version.to + fadeYears) {
    return { alpha: 0, flash: 0 };
  }
  if (year < version.from + fadeYears) {
    const t = (year - version.from) / fadeYears;
    // Flash peaks early in the ramp and is gone by the time the fade completes,
    // so it reads as a pulse rather than a permanent colour difference.
    return { alpha: t, flash: flashStrengthFor(version) * (1 - t) };
  }
  if (year > version.to) {
    return { alpha: 1 - (year - version.to) / fadeYears, flash: 0 };
  }
  return { alpha: 1, flash: 0 };
}

export function activeAt(versions, year, fadeYears, out = []) {
  out.length = 0;
  for (let i = 0; i < versions.length; i++) {
    const { alpha, flash } = stateFor(versions[i], year, fadeYears);
    if (alpha > 0.002) out.push({ i, version: versions[i], alpha, flash });
  }
  return out;
}

export function changeYears(versions, from, to) {
  const set = new Set();
  for (const v of versions) {
    if (v.from >= from && v.from <= to) set.add(v.from);
    if (v.to >= from && v.to <= to) set.add(v.to);
  }
  return [...set].sort((a, b) => a - b);
}
