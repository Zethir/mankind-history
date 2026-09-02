import { fitTransform, equalEarth } from './projection.mjs';
import { activeAt } from './temporal.mjs';
import { buildPalette, fillFor, strokeFor, GROUND } from './palette.mjs';

// Three tones carry the whole ground layer:
//
//   sea             recessive
//   unclaimed land  quiet, but never confusable with sea
//   territory       the only saturated thing on screen
//
// The middle tone is also the diagnostic. A year where the plate is mostly bare
// land is a year the dataset is thin, visible at a glance, with no separate
// coverage overlay needed.

function buildPaths(versions) {
  return versions.map((version) => {
    const path = new Path2D();
    for (const rings of version.polys) {
      for (const flat of rings) {
        path.moveTo(flat[0], flat[1]);
        for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
        path.closePath();
      }
    }
    return path;
  });
}

function buildLandPath(land) {
  const path = new Path2D();
  if (!land) return path;
  for (const rings of land.polys) {
    for (const flat of rings) {
      path.moveTo(flat[0], flat[1]);
      for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
      path.closePath();
    }
  }
  return path;
}

function buildGraticule(bbox, stepDeg = 10) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const path = new Path2D();
  const start = (v) => Math.ceil(v / stepDeg) * stepDeg;
  for (let lon = start(minLon); lon <= maxLon; lon += stepDeg) {
    let first = true;
    for (let lat = minLat; lat <= maxLat + 0.001; lat += 1) {
      const [x, y] = equalEarth(lon, Math.min(lat, maxLat));
      if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
    }
  }
  for (let lat = start(minLat); lat <= maxLat; lat += stepDeg) {
    let first = true;
    for (let lon = minLon; lon <= maxLon + 0.001; lon += 1) {
      const [x, y] = equalEarth(Math.min(lon, maxLon), lat);
      if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
    }
  }
  return path;
}

export class Renderer {
  constructor(canvas, slice, land) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.slice = slice;
    this.paths = buildPaths(slice.versions);
    this.palette = buildPalette(slice.polities);
    this.land = buildLandPath(land);
    this.graticule = buildGraticule(slice.meta.region.bbox);
    this.active = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.dpr = dpr;
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.transform = fitTransform(this.slice.meta.projectedBounds, rect.width, rect.height, 16);
  }

  applyTransform() {
    const { scale, offsetX, offsetY } = this.transform;
    const d = this.dpr;
    this.ctx.setTransform(scale * d, 0, 0, -scale * d, offsetX * d, offsetY * d);
  }

  draw(year, fadeYears) {
    const t0 = performance.now();
    const { ctx } = this;
    const { scale } = this.transform;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = GROUND.sea;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.applyTransform();

    ctx.fillStyle = GROUND.land;
    ctx.fill(this.land, 'evenodd');

    ctx.lineWidth = 0.8 / scale;
    ctx.strokeStyle = GROUND.graticule;
    ctx.stroke(this.graticule);

    activeAt(this.slice.versions, year, fadeYears, this.active);

    ctx.lineJoin = 'round';
    for (const entry of this.active) {
      const color = this.palette[entry.version.p];
      ctx.globalAlpha = entry.alpha;
      ctx.fillStyle = fillFor(color, entry.flash);
      ctx.fill(this.paths[entry.i], 'evenodd');
      ctx.globalAlpha = entry.alpha * 0.55;
      ctx.strokeStyle = strokeFor(color);
      ctx.lineWidth = 0.8 / scale;
      ctx.stroke(this.paths[entry.i]);
    }

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = GROUND.coast;
    ctx.lineWidth = 0.7 / scale;
    ctx.stroke(this.land);
    ctx.globalAlpha = 1;

    return { count: this.active.length, ms: performance.now() - t0, active: this.active };
  }

  /**
   * Which polity is under the cursor? Topmost wins, so iterate the active list
   * backwards: it is sorted largest-first for drawing, and the last one drawn
   * is the one visible.
   *
   * isPointInPath tests against the current transform, so re-apply it first.
   */
  hitTest(cssX, cssY) {
    this.applyTransform();
    const x = cssX * this.dpr;
    const y = cssY * this.dpr;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const entry = this.active[i];
      if (entry.alpha < 0.35) continue;
      if (this.ctx.isPointInPath(this.paths[entry.i], x, y, 'evenodd')) {
        return entry;
      }
    }
    return null;
  }
}
