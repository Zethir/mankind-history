import type { LandArtifact, Polygon, VersionsArtifact } from "@history/model";
import type { Frame } from "../engine/frame";
import { buildPalette, type Palette } from "./palette";
import { buildPolityIndex } from "./polity-index";
import { fitWorld, toScreen, type Viewport } from "./transform";

/**
 * Three ground tones and nothing else, per decision 0003. The middle tone is
 * also the coverage diagnostic: a year where the plate is mostly bare land is
 * a year the dataset is thin, visible at a glance with no separate overlay.
 */
const SEA = "#101b26";
const LAND = "#2b3440";
const FLASH = "#fdf6e3";
/**
 * Stroked around every filled polity, after the fill, so two neighbours that
 * land on the same palette colour (decision 0016: only 30-40 sprawling
 * empires ever get a graph-coloured guarantee against that; roughly 1,450
 * compact polities still share a muted palette by hash, so repeats among
 * neighbours are expected) read as separate shapes instead of merging into
 * one blob. Darker than both ground tones -- LAND is #2b3440, SEA is
 * #101b26 -- so it reads as a seam on every fill, including the darkest
 * palette lightness band, rather than disappearing into the plate the way a
 * mid-tone stroke would over SEA.
 */
const OUTLINE = "#04070a";

export class MapRenderer {
  readonly viewport: Viewport;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paths = new Map<string, Path2D>();
  private readonly polityOf: Map<string, string>;
  private readonly areaOf = new Map<string, number>();
  private readonly palette: Palette;
  private landPath: Path2D | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly versions: VersionsArtifact,
    private readonly land: LandArtifact,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.polityOf = buildPolityIndex(versions);
    this.palette = buildPalette(versions);
    for (const r of versions.rows) {
      this.areaOf.set(r.id, r.area);
    }
    this.viewport = fitWorld(canvas.clientWidth, canvas.clientHeight);
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const fitted = fitWorld(width, height);
    Object.assign(this.viewport, fitted);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paths are built in screen space, so a resize invalidates all of them.
    this.paths.clear();
    this.landPath = null;
  }

  draw(frame: Frame): void {
    const { ctx, viewport } = this;
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    if (!this.landPath) {
      this.landPath = this.buildPath(this.land.polygons, this.land.coordScale);
    }
    ctx.fillStyle = LAND;
    ctx.fill(this.landPath);

    // Descending area, so a small polity is never buried under an empire that
    // merely happens to sort later.
    const ordered = [...frame.draws].sort(
      (a, b) => (this.areaOf.get(b.versionId) ?? 0) - (this.areaOf.get(a.versionId) ?? 0),
    );

    for (const d of ordered) {
      const path = this.pathFor(d.versionId);
      if (!path) continue;
      // A version with no polity in the index is a contract violation
      // between this frame and this artifact -- skip the draw rather than
      // colour it by version id, which would make one polity's successive
      // versions take different colours and read as distinct entities. See
      // decision 0001 and polity-index.ts.
      const polityId = this.polityOf.get(d.versionId);
      if (polityId === undefined) continue;
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = this.palette.colourFor(polityId);
      ctx.fill(path);
      // Same globalAlpha as the fill, so the outline fades with the version
      // rather than persisting as a solid line after the shape has faded out.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke(path);
      if (d.flash > 0) {
        ctx.globalAlpha = d.alpha * d.flash * 0.55;
        ctx.fillStyle = FLASH;
        ctx.fill(path);
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Built lazily and cached. Bounded at one entry per version, so no eviction
   * is needed, and time-to-first-frame does not pay for 2.4M vertices of path
   * construction up front.
   */
  private pathFor(versionId: string): Path2D | null {
    const cached = this.paths.get(versionId);
    if (cached) return cached;
    const geometry = this.versions.geometry[versionId];
    if (!geometry) return null;
    const path = this.buildPath(geometry.polygons, this.versions.coordScale);
    this.paths.set(versionId, path);
    return path;
  }

  private buildPath(polygons: readonly Polygon[], coordScale: number): Path2D {
    const path = new Path2D();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const [sx, sy] = toScreen(
            this.viewport,
            ring[i] as number,
            ring[i + 1] as number,
            coordScale,
          );
          if (i === 0) path.moveTo(sx, sy);
          else path.lineTo(sx, sy);
        }
        path.closePath();
      }
    }
    return path;
  }
}
