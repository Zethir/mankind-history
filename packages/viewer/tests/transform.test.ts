import { COORD_SCALE, WORLD_HALF_WIDTH } from "@history/model";
import { describe, expect, it } from "vitest";
import {
  fitScale,
  fitWorld,
  fromScreen,
  MAX_ZOOM_FACTOR,
  panBy,
  toScreen,
  zoomAt,
} from "../src/render/transform";

const S = COORD_SCALE.coarse;

describe("zoomAt", () => {
  // Acceptance criterion 1. This is the property that makes zoom feel
  // controlled rather than lurching, and it drifts silently when the centre
  // maths is wrong.
  //
  // Deviation from the brief's literal anchor/factor list, measured rather
  // than assumed -- see the report this shipped with for the full derivation:
  // 1400x900 is width-bound (258.6 px/unit, per the brief), which means the
  // *height* axis has surplus at fit -- canvas half-height in world units
  // (450/258.6 = 1.7397) exceeds WORLD_HALF_HEIGHT (1.31736) by 0.4223. The
  // pan clamp (see transform.ts's `clamp`) deliberately pins an axis to its
  // centre whenever that axis has surplus, exactly the behaviour the brief's
  // own note requires for the width-bound axis at exact fit ("the pan limit
  // is zero and the centre pins to 0"). Applied to the height axis, that same
  // rule locks centreY to exactly 0 until the zoom closes the 0.4223-unit gap
  // -- factor >= 341.55/258.62 ~= 1.321 -- so at factor 1.1 (below that
  // threshold) *no* off-centre vertical anchor can be honoured. Factor 2 is
  // just above the threshold, so centreY is no longer pinned to exactly 0
  // there, but the achievable range is still only +-0.4473 (WORLD_HALF_HEIGHT
  // minus the half-extent at that scale), too small for the anchors this test
  // dropped. And the canvas corners (screen y 0 and 899, whose unprojected y
  // already exceeds WORLD_HALF_HEIGHT at fit) can never be honoured at *any*
  // factor: as scale grows the achievable centreY approaches WORLD_HALF_HEIGHT
  // in the limit, which is permanently short of what a corner anchor needs.
  // This is a property of any implementation that also
  // satisfies "never pushes the world entirely off screen" on this canvas --
  // confirmed by sweeping the original four anchors against the brief's exact
  // implementation (`packages/viewer/probe*.mjs`, run and discarded; see the
  // task report). The anchors and factors below are chosen to still sweep
  // off-centre positions in both axes and both zoom directions, verified
  // reachable (checked with the real implementation before committing).
  it("leaves the projected point under the cursor fixed", () => {
    const base = fitWorld(1400, 900);
    for (const factor of [8, 0.5, 0.25]) {
      for (const [sx, sy] of [
        [700, 450],
        [1399, 700],
        [200, 300],
        [1000, 600],
      ] as const) {
        const before = fromScreen(base, sx, sy, S);
        const zoomed = zoomAt(base, factor, sx, sy);
        const after = fromScreen(zoomed, sx, sy, S);
        expect(after[0]).toBeCloseTo(before[0], 3);
        expect(after[1]).toBeCloseTo(before[1], 3);
      }
    }
  });

  // The excluded case named above: an anchor near the vertical letterbox
  // margin at a zoom factor too small to have closed the pre-existing surplus
  // gap must still leave the *other* axis (the width-bound one, which has no
  // surplus at fit) exactly fixed -- this is the one piece of criterion 1 that
  // does hold unconditionally for this canvas, and is worth pinning on its own.
  it("still fixes the width-bound axis when the height axis is clamped to centre", () => {
    const base = fitWorld(1400, 900);
    for (const factor of [1.1, 2]) {
      for (const sx of [0, 1399, 200]) {
        const before = fromScreen(base, sx, 800, S);
        const zoomed = zoomAt(base, factor, sx, 800);
        const after = fromScreen(zoomed, sx, 800, S);
        expect(after[0]).toBeCloseTo(before[0], 3);
      }
    }
  });

  it("multiplies the scale by the factor, within the clamp", () => {
    const base = fitWorld(1400, 900);
    expect(zoomAt(base, 2, 700, 450).scale).toBeCloseTo(base.scale * 2, 6);
  });

  // Acceptance criterion 4.
  it("never zooms out past fit", () => {
    const base = fitWorld(1400, 900);
    expect(zoomAt(base, 0.1, 700, 450).scale).toBeCloseTo(base.scale, 6);
  });

  it("never zooms in past the maximum", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 50; i++) v = zoomAt(v, 2, 700, 450);
    expect(v.scale).toBeCloseTo(fitScale(1400, 900) * MAX_ZOOM_FACTOR, 6);
  });
});

describe("panBy", () => {
  it("moves the world by exactly the requested screen distance", () => {
    const v = zoomAt(fitWorld(1400, 900), 4, 700, 450);
    const before = fromScreen(v, 700, 450, S);
    const panned = panBy(v, 100, 0);
    const after = fromScreen(panned, 800, 450, S);
    expect(after[0]).toBeCloseTo(before[0], 3);
  });

  // Acceptance criterion 4.
  it("cannot push the world entirely off screen", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 100; i++) v = panBy(v, 10_000, 10_000);
    const [wx] = fromScreen(v, 700, 450, S);
    expect(Math.abs(wx / S)).toBeLessThanOrEqual(WORLD_HALF_WIDTH + 1e-6);
  });
});

describe("toScreen / fromScreen", () => {
  // Acceptance criterion 3. Milestone 1 only round-tripped at fit.
  it("round-trips within a pixel at every zoom level", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 6; i++) {
      for (const [x, y] of [
        [0, 0],
        [S, S],
        [-2 * S, S / 2],
      ] as const) {
        const [sx, sy] = toScreen(v, x, y, S);
        const [bx, by] = fromScreen(v, sx, sy, S);
        const [rx, ry] = toScreen(v, bx, by, S);
        expect(Math.abs(rx - sx)).toBeLessThan(1);
        expect(Math.abs(ry - sy)).toBeLessThan(1);
      }
      v = zoomAt(v, 2, 700, 450);
    }
  });

  it("puts north at the top at every zoom level", () => {
    let v = fitWorld(1400, 900);
    for (let i = 0; i < 4; i++) {
      const [, north] = toScreen(v, 0, S, S);
      const [, south] = toScreen(v, 0, -S, S);
      expect(north).toBeLessThan(south);
      v = zoomAt(v, 2, 700, 450);
    }
  });
});

describe("fitWorld", () => {
  // Acceptance criterion 2.
  it("is the identity that any pan and zoom sequence resets to", () => {
    const fit = fitWorld(1400, 900);
    let v = fit;
    v = zoomAt(v, 4, 300, 200);
    v = panBy(v, -250, 90);
    v = zoomAt(v, 0.5, 900, 700);
    const reset = fitWorld(v.width, v.height);
    expect(reset).toEqual(fit);
  });

  it("centres the world", () => {
    const v = fitWorld(1400, 900);
    expect(v.centreX).toBe(0);
    expect(v.centreY).toBe(0);
  });
});

describe("degenerate canvas", () => {
  // Before the browser's first layout pass, canvas.clientWidth/clientHeight
  // read 0 (canvas.ts's constructor calls fitWorld with exactly these).
  // fitScale(0, h) and fitScale(w, 0) both return 0, and clamp() divides by
  // scale when computing half-extents -- unguarded, that division yields
  // NaN, which propagates through every downstream toScreen call as a
  // silently blank map, never a thrown error.
  //
  // A wrong value here is a NaN or Infinity centreX/centreY -- checked with
  // toBe(0), not Number.isFinite(...): a guard that "fixes" NaN into some
  // other wrong-but-finite number (for instance by leaking the pre-division
  // Infinity through Math.min/Math.max unchanged) would pass an
  // is-finite check but still fail this one.
  it("keeps zoomAt's centre finite when width is zero", () => {
    const v = zoomAt(fitWorld(0, 900), 2, 0, 450);
    expect(v.centreX).toBe(0);
    expect(v.centreY).toBe(0);
    expect(Number.isFinite(v.scale)).toBe(true);
  });

  it("keeps panBy's centre finite when height is zero", () => {
    const v = panBy(fitWorld(1400, 0), 100, 50);
    expect(v.centreX).toBe(0);
    expect(v.centreY).toBe(0);
    expect(Number.isFinite(v.scale)).toBe(true);
  });
});
