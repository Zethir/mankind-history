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
 * `scale` is the real pixels-per-projected-unit figure. At 1400x900 it
 * measures 258.6242, which `canon.ts` records as `DISPLACEMENT_REFERENCE_SCALE`
 * -- the fixed scale the border-displacement acceptance criterion is measured
 * at (decision 0020), not a value this renderer itself consults.
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

/**
 * The viewport's visible extent in unscaled projected units, as
 * [minX, minY, maxX, maxY] -- the shape `Engine.setViewportBbox` and
 * `cellRangeFor` expect. World y is up, but min/max ordering does not care
 * which screen edge a coordinate corresponds to: `centreY - halfHeight` is
 * always the smaller of the two since halfHeight is non-negative, so unlike
 * `toScreen` (which flips y to draw) this needs no flip.
 */
export function viewportBbox(v: Viewport): [number, number, number, number] {
  const halfW = v.width / 2 / v.scale;
  const halfH = v.height / 2 / v.scale;
  return [v.centreX - halfW, v.centreY - halfH, v.centreX + halfW, v.centreY + halfH];
}

/**
 * Natural-log zoom units per pixel of wheel deltaY. A wheel notch on a
 * standard mouse reports about 100 px of deltaY, so at 0.004 one notch
 * multiplies scale by exp(0.4) = 1.49 and the full fit-to-MAX_ZOOM_FACTOR
 * range takes ln(64) / 0.4 = about 10 notches.
 *
 * It was 0.0015, which took about 28 notches to cross the same range and the
 * owner found frustrating to interact with. Exponential rather than additive
 * so a notch is the same proportional step at every zoom level, which is what
 * makes zoom feel even rather than crawling when close and lurching when far.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.004;

/**
 * Wheel events do not all report deltaY in pixels. `deltaMode` 1 means lines
 * and 2 means pages, and a browser reporting lines sends about 3 per notch
 * rather than about 100 -- so treating its deltaY as pixels makes the wheel
 * appear almost dead. These convert to the pixel scale the sensitivity is
 * calibrated against.
 */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;

/**
 * The most a single wheel event may zoom, as a natural-log magnitude:
 * ln(4), so one event can never do more than a factor of four. Some input
 * stacks emit one enormous deltaY for an inertial flick, which without this
 * would jump from fit to maximum zoom in a single frame and lose the user's
 * place entirely.
 */
const WHEEL_MAX_STEP = Math.log(4);

/**
 * How much more zoom a pinch's deltaY is worth than a scroll's.
 *
 * A trackpad pinch does not arrive as its own event type: the OS synthesises
 * a wheel event with `ctrlKey` set, and the deltaY it carries is on a much
 * smaller scale than a two-finger slide's for the same physical finger
 * travel. With one shared sensitivity the two gestures therefore zoom by
 * visibly different amounts, which is what the owner reported.
 *
 * `ctrlKey` is an exact signal for pinch, unlike telling a two-finger slide
 * from a mouse wheel, which has no reliable flag and can only be guessed at
 * from delta magnitudes -- a guess that would make a real mouse wheel behave
 * wrongly when it misfires. So the pinch path is separated and the scroll
 * path is left to cover both slide and wheel.
 *
 * 10 is a starting point, not a measurement: the ratio depends on the
 * trackpad and the OS, and there is no device here to measure it against.
 * It is one constant, and tuning it is the intended way to adjust pinch
 * feel without touching scroll.
 */
const PINCH_ZOOM_MULTIPLIER = 10;

/**
 * The zoom factor one wheel event should apply, normalised across the three
 * `deltaMode` units and clamped so no single event can zoom more than 4x.
 * Separated from the DOM listener in `ui/chrome.ts` so the arithmetic is
 * testable under `environment: "node"` without a DOM.
 *
 * `pinch` is the event's `ctrlKey`: true for a trackpad pinch, false for a
 * two-finger slide or a mouse wheel. The clamp applies to both paths, so a
 * pinch cannot outrun it either.
 *
 * deltaY is positive when scrolling down/away, which zooms out, hence the
 * negation.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, pinch = false): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px =
    deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * WHEEL_PAGE_PX : deltaY;
  const sensitivity = pinch
    ? WHEEL_ZOOM_SENSITIVITY * PINCH_ZOOM_MULTIPLIER
    : WHEEL_ZOOM_SENSITIVITY;
  const step = -px * sensitivity;
  return Math.exp(Math.min(Math.max(step, -WHEEL_MAX_STEP), WHEEL_MAX_STEP));
}
