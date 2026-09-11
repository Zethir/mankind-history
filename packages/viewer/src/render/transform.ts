import { WORLD_HALF_HEIGHT, WORLD_HALF_WIDTH } from "@history/model";

/**
 * A view of the projected world: where the centre of the canvas sits in
 * projected units, and how many screen pixels one projected unit occupies.
 *
 * Milestone 1 could describe a viewport by its offsets because there was only
 * ever one -- the whole world, centred. With zoom and pan the centre moves, so
 * it is stored rather than derived.
 */
export interface Viewport {
  width: number;
  height: number;
  /** Screen pixels per projected unit. */
  scale: number;
  /** Projected coordinates at the centre of the canvas. */
  centreX: number;
  centreY: number;
}

/** How far past fit-to-window zoom may go. Full detail is what makes this useful. */
export const MAX_ZOOM_FACTOR = 64;

export function fitScale(width: number, height: number): number {
  return Math.min(width / (WORLD_HALF_WIDTH * 2), height / (WORLD_HALF_HEIGHT * 2));
}

/**
 * Fits the whole projected world into a canvas, preserving aspect and
 * centring. The projected world is 2 * WORLD_HALF_WIDTH units across.
 *
 * `scale` is the real pixels-per-projected-unit figure that canon.ts's
 * PX_PER_UNIT only guessed at. Milestone 2 replaces those constants with it.
 */
export function fitWorld(width: number, height: number): Viewport {
  return { width, height, scale: fitScale(width, height), centreX: 0, centreY: 0 };
}

/** Scaled-integer projected coordinates to screen pixels. Y is flipped: north is up. */
export function toScreen(v: Viewport, x: number, y: number, coordScale: number): [number, number] {
  return [
    v.width / 2 + (x / coordScale - v.centreX) * v.scale,
    v.height / 2 - (y / coordScale - v.centreY) * v.scale,
  ];
}

/** The inverse of toScreen, in the same scaled-integer space. */
export function fromScreen(
  v: Viewport,
  sx: number,
  sy: number,
  coordScale: number,
): [number, number] {
  return [
    (v.centreX + (sx - v.width / 2) / v.scale) * coordScale,
    (v.centreY - (sy - v.height / 2) / v.scale) * coordScale,
  ];
}

/**
 * Clamps scale to [fit, fit * MAX_ZOOM_FACTOR] and keeps the centre inside the
 * world, so the map can never be pushed entirely off screen or zoomed out into
 * empty space around it.
 *
 * A canvas with zero width or height (real during the gap between mount and
 * the browser's first layout pass -- `canvas.clientWidth`/`clientHeight` read
 * 0 until then) makes `fitScale` return 0, which would otherwise divide the
 * half-extents below by zero and hand every caller a NaN centre -- silently,
 * since NaN propagates through the arithmetic in `toScreen` without ever
 * throwing, rendering a blank map with no error to point at. Guarded on
 * `scale` itself (what is actually about to be divided by), not on
 * width/height, so this also catches a NaN/Infinity scale arriving from a
 * caller that divided by an already-degenerate `v.scale` (`zoomAt` and
 * `panBy` both do, before reaching here). The centre a degenerate canvas
 * "should" have is not an obvious question -- there is no meaningful
 * half-extent to centre within -- so this matches `fitWorld`'s own answer for
 * every canvas size, degenerate or not: the world's origin.
 */
function clamp(v: Viewport): Viewport {
  const min = fitScale(v.width, v.height);
  const scale = Math.min(Math.max(v.scale, min), min * MAX_ZOOM_FACTOR);
  if (!(scale > 0)) {
    return { width: v.width, height: v.height, scale, centreX: 0, centreY: 0 };
  }
  // Half the visible extent, in projected units. When the view is wider than
  // the world there is nothing to clamp on that axis, so the centre pins to 0.
  const halfW = v.width / 2 / scale;
  const halfH = v.height / 2 / scale;
  const limitX = Math.max(0, WORLD_HALF_WIDTH - halfW);
  const limitY = Math.max(0, WORLD_HALF_HEIGHT - halfH);
  return {
    width: v.width,
    height: v.height,
    scale,
    centreX: Math.min(Math.max(v.centreX, -limitX), limitX),
    centreY: Math.min(Math.max(v.centreY, -limitY), limitY),
  };
}

/**
 * Zoom about a screen point, keeping the projected coordinate under that point
 * fixed. Anchoring at the cursor is what makes zoom feel controlled; anchoring
 * at the centre makes the map slide away from wherever you are looking.
 */
export function zoomAt(v: Viewport, factor: number, screenX: number, screenY: number): Viewport {
  const min = fitScale(v.width, v.height);
  const scale = Math.min(Math.max(v.scale * factor, min), min * MAX_ZOOM_FACTOR);
  // The world point under the cursor, before and after, must agree.
  const wx = v.centreX + (screenX - v.width / 2) / v.scale;
  const wy = v.centreY - (screenY - v.height / 2) / v.scale;
  return clamp({
    width: v.width,
    height: v.height,
    scale,
    centreX: wx - (screenX - v.width / 2) / scale,
    centreY: wy + (screenY - v.height / 2) / scale,
  });
}

/** Drag the map by a screen distance. */
export function panBy(v: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return clamp({
    width: v.width,
    height: v.height,
    scale: v.scale,
    centreX: v.centreX - dxScreen / v.scale,
    centreY: v.centreY + dyScreen / v.scale,
  });
}
