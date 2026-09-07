import type { Version } from "@history/model";

/** Relative area growth at which the flash reaches full strength (0004). */
export const FULL_FLASH_AT = 0.5;

/** Gap in years beyond which growth is not attributable to an event (0004). */
export const MAX_ATTRIBUTABLE_GAP = 50;

/**
 * Decision 0004. Brightness reads as conquest, so it is suppressed wherever
 * the data cannot support that reading. The flash going quiet exactly where
 * coverage is weakest is the intended behaviour, not a bug.
 *
 * Strength scales with RELATIVE area change so a small polity doubling reads
 * as strongly as an empire gaining a few percent. `prevArea` is not stored on
 * Version; it is exactly `area - delta`, both being build-time values.
 */
export function flashStrengthFor(v: Version): number {
  if (v.prevId === null) return 0;
  if (v.gap !== null && v.gap > MAX_ATTRIBUTABLE_GAP) return 0;
  if (v.delta === null || v.delta <= 0) return 0;
  const prevArea = v.area - v.delta;
  if (prevArea <= 0) return 0;
  return Math.min(1, v.delta / prevArea / FULL_FLASH_AT);
}

/**
 * The flash is an event, not a tint: it rides the fade-in, peaks as the
 * version reaches full opacity, and decays away over twice the fade width.
 */
export function flashEnvelope(year: number, fromYear: number, fadeYears: number): number {
  if (fadeYears <= 0) return 0;
  const decay = fadeYears * 2;
  const t = year - fromYear;
  if (t < 0 || t >= fadeYears + decay) return 0;
  if (t < fadeYears) return t / fadeYears;
  return 1 - (t - fadeYears) / decay;
}
