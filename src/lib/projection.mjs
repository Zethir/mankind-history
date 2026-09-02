// Equal Earth (Savric, Patterson & Jenny, 2018).
// Equal-area, so territorial extent reads honestly. No dependencies.
//
// Note for later: at Mediterranean latitudes an Albers conic would be a better
// regional fit. Equal Earth is used here because the eventual product is global
// and it costs nothing to stay consistent.

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;
const M = Math.sqrt(3) / 2;
const RAD = Math.PI / 180;

/**
 * @param {number} lon degrees
 * @param {number} lat degrees
 * @returns {[number, number]} projected [x, y], roughly x in [-2.7, 2.7], y in [-1.3, 1.3]
 */
export function equalEarth(lon, lat) {
  const lambda = lon * RAD;
  const phi = lat * RAD;
  const theta = Math.asin(M * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const t8 = t6 * t2;
  // dy/dtheta, used to keep the projection equal-area
  const dydt = A1 + 3 * A2 * t2 + 7 * A3 * t6 + 9 * A4 * t8;
  const x = (lambda * Math.cos(theta)) / (M * dydt);
  const y = A1 * theta + A2 * theta * t2 + A3 * theta * t6 + A4 * theta * t8;
  return [x, y];
}

/**
 * Fit projected coordinates to a pixel viewport, preserving aspect ratio.
 * @param {[number,number,number,number]} bounds projected [minX, minY, maxX, maxY]
 */
export function fitTransform(bounds, width, height, padding = 24) {
  const [minX, minY, maxX, maxY] = bounds;
  const sx = (width - padding * 2) / (maxX - minX);
  const sy = (height - padding * 2) / (maxY - minY);
  const scale = Math.min(sx, sy);
  const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
  // canvas y grows downward, projected y grows upward
  const offsetY = (height + (maxY - minY) * scale) / 2 + minY * scale;
  return { scale, offsetX, offsetY };
}
