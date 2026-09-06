/**
 * Equal Earth (Savric, Patterson & Jenny, 2018). Equal-area, so territorial
 * extent reads honestly -- decision 0002. Forward transform ported from the
 * Phase 0 spike; the inverse is new, because the round-trip acceptance
 * criterion needs it and Equal Earth has no closed form.
 */

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** y as a function of the parametric latitude theta. */
function yOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 * theta + A2 * theta * t2 + A3 * theta * t6 + A4 * theta * t6 * t2;
}

/** dy/dtheta. Strictly positive over the valid range, so Newton converges. */
function dyOf(theta: number): number {
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  return A1 + 3 * A2 * t2 + 7 * A3 * t6 + 9 * A4 * t6 * t2;
}

export function equalEarth(lon: number, lat: number): [number, number] {
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const theta = Math.asin(M * Math.sin(phi));
  return [(lambda * Math.cos(theta)) / (M * dyOf(theta)), yOf(theta)];
}

/**
 * Newton iteration on y to recover theta, then closed form for lon and lat.
 * Converges in fewer than ten iterations everywhere; the cap is a guard, not a
 * budget.
 */
export function equalEarthInverse(x: number, y: number): [number, number] {
  let theta = y;
  for (let i = 0; i < 20; i++) {
    const step = (yOf(theta) - y) / dyOf(theta);
    theta -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  const lambda = (x * M * dyOf(theta)) / Math.cos(theta);
  // At |lat| = 90, floating-point overshoot can push this just past 1, where
  // Math.asin returns NaN. Natural Earth's Antarctica polygon reaches lat -90,
  // and an acceptance criterion forbids NaN in output.
  const phi = Math.asin(Math.min(1, Math.max(-1, Math.sin(theta) / M)));
  return [lambda * DEG, phi * DEG];
}
