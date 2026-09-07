import { WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";

/** A fitted view of the projected world. Milestone 1 has no pan or zoom. */
export interface Viewport {
  width: number;
  height: number;
  /** Screen pixels per projected unit. */
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fits the whole projected world into a canvas, preserving aspect and
 * centring. The projected world is 2 * WORLD_HALF_WIDTH units across.
 *
 * `scale` is the real pixels-per-projected-unit figure that canon.ts's
 * PX_PER_UNIT only guessed at. Milestone 2 replaces those constants with it.
 */
export function fitWorld(width: number, height: number): Viewport {
  const scale = Math.min(width / (WORLD_HALF_WIDTH * 2), height / (WORLD_HALF_HEIGHT * 2));
  return { width, height, scale, offsetX: width / 2, offsetY: height / 2 };
}

/** Scaled-integer projected coordinates to screen pixels. Y is flipped: north is up. */
export function toScreen(v: Viewport, x: number, y: number, coordScale: number): [number, number] {
  return [v.offsetX + (x / coordScale) * v.scale, v.offsetY - (y / coordScale) * v.scale];
}

/** The inverse of toScreen, in the same scaled-integer space. */
export function fromScreen(
  v: Viewport,
  sx: number,
  sy: number,
  coordScale: number,
): [number, number] {
  return [((sx - v.offsetX) / v.scale) * coordScale, ((v.offsetY - sy) / v.scale) * coordScale];
}
