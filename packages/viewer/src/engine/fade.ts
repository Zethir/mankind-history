import { FADE_SECONDS } from "./constants";

/**
 * Fade width in years, per version. Amends decision 0006, whose
 * `clamp(FADE_SECONDS * speed, 1.5, medianVersionDuration / 6)` is ill-defined
 * against the real data: the measured median duration of 7 years puts the
 * upper bound at 1.17, below the lower bound of 1.5.
 *
 * The cap is on extent -- the years the version actually occupies -- and not
 * on `toYear - fromYear`. 1,190 versions (8.9%) have `toYear === fromYear`, so
 * a duration-based cap would fade them over zero years: a hard cut on a tenth
 * of the dataset, which is precisely what decision 0001 exists to avoid.
 */
export function fadeYearsFor(fromYear: number, toYear: number, speed: number): number {
  const extent = toYear - fromYear + 1;
  return Math.min(FADE_SECONDS * speed, extent / 2);
}

/**
 * Opacity at a fractional year. Ramps up over [fromYear, fromYear + fade],
 * holds at 1 until toYear + 1, then dissolves over the following `fade` years.
 *
 * Both fades sit inside or after the claim, never before it. Decision 0001
 * requires the dissolve to follow toYear, because the polity genuinely existed
 * up to it; the same argument forbids ramping up ahead of fromYear. The
 * crossfade still works, because a successor's fromYear is its predecessor's
 * toYear + 1, so the fade-in overlaps the fade-out exactly -- but only the
 * predecessor is ever shown outside its own claim.
 */
export function alphaFor(
  year: number,
  fromYear: number,
  toYear: number,
  fadeYears: number,
): number {
  const end = toYear + 1;
  if (year < fromYear || year >= end + fadeYears) return 0;
  if (fadeYears <= 0) return 1;
  if (year < fromYear + fadeYears) return (year - fromYear) / fadeYears;
  if (year <= end) return 1;
  return 1 - (year - end) / fadeYears;
}
