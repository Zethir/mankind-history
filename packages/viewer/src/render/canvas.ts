import type { LandArtifact, Polygon, VersionsArtifact } from "@history/model";
import type { Frame } from "../engine/frame";
import { buildPalette, type Palette } from "./palette";
import { buildPolityIndex, type PolityIndexEntry } from "./polity-index";
import { colourForDraw, type RenderMode } from "./render-mode";
import { fitWorld, toScreen, type Viewport } from "./transform";

/**
 * Three ground tones and nothing else, per decision 0003. The middle tone is
 * also the coverage diagnostic: a year where the plate is mostly bare land is
 * a year the dataset is thin, visible at a glance with no separate overlay.
 *
 * Kept unchanged for the 1970s family palette (docs/decisions/0018), judged
 * rather than re-measured: both are cool, dark, low-saturation blue-grays
 * (SEA hsl(210 41% 11%), LAND hsl(214 20% 21%)), while every territory family
 * is either warm or a muted green/teal at meaningfully higher lightness and a
 * different hue -- the closest is the teal family's darkest shade,
 * hsl(200 26% 28%), still 7 points lighter and 6 points more saturated than
 * LAND with a 14-degree hue gap, and every fill also gets its own dark
 * OUTLINE seam on top. FLASH's cream (hsl(44 87% 94%)) already reads as
 * exactly the period cream the brief's reference palettes call for, so it
 * needed no change either -- a fortunate coincidence, not a redesign.
 */
const SEA = "#101b26";
const LAND = "#2b3440";
const FLASH = "#fdf6e3";
/**
 * Stroked around every filled polity, after the fill, so two neighbours that
 * land on the same palette colour (declination deliberately repeats shades
 * within one empire past 4 members, and the hash-assigned remainder can
 * still collide by chance -- see docs/decisions/0018) read as separate
 * shapes instead of merging into one blob. Darker than both ground tones --
 * LAND is #2b3440, SEA is #101b26 -- so it reads as a seam on every fill,
 * including the darkest palette lightness band, rather than disappearing
 * into the plate the way a mid-tone stroke would over SEA.
 */
const OUTLINE = "#04070a";

/**
 * Heavier than the ordinary per-polity outline (1) so an aggregate's boundary
 * still reads as a deliberate "this is the empire" mark in "outline" mode,
 * not just another polity seam -- but only just heavier. The family palette
 * (docs/decisions/0018-family-palette.md) already does most of the work of
 * saying "these are one empire" by shading every member the same hue, so the
 * stroke no longer has to carry that signal alone the way it did at 3px;
 * 1.5px is enough to separate "this line means something" from the ordinary
 * 1px seam without the outline mode reading as busier than the fill colours
 * underneath it.
 */
const AGGREGATE_OUTLINE_WIDTH = 1.5;

export class MapRenderer {
  readonly viewport: Viewport;
  /**
   * Which of the three render modes (render-mode.ts) aggregate polities
   * render under. Public and mutable, read directly by draw() every frame,
   * so the chrome's control can set it and read it back with no shadow state
   * of its own -- the same pattern engine.playing and clock.userSpeed
   * already use.
   */
  mode: RenderMode = "none";
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paths = new Map<string, Path2D>();
  private readonly polityOf: Map<string, PolityIndexEntry>;
  private readonly areaOf = new Map<string, number>();
  private readonly knownPolityIds: ReadonlySet<string>;
  /** Polity ids named by at least one version's memberOf -- see draw(). */
  private readonly aggregateIds: ReadonlySet<string>;
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
    const knownPolityIds = new Set<string>();
    const aggregateIds = new Set<string>();
    for (const r of versions.rows) {
      this.areaOf.set(r.id, r.area);
      knownPolityIds.add(r.polityId);
      if (r.memberOf !== null) aggregateIds.add(r.memberOf);
    }
    this.knownPolityIds = knownPolityIds;
    this.aggregateIds = aggregateIds;
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
      // A version with no entry in the index is a contract violation between
      // this frame and this artifact -- skip the draw rather than colour it
      // by version id, which would make one polity's successive versions
      // take different colours and read as distinct entities. See decision
      // 0001 and polity-index.ts.
      const entry = this.polityOf.get(d.versionId);
      if (entry === undefined) continue;
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = colourForDraw(entry, this.mode, this.palette, this.knownPolityIds);
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

    // "outline" mode: every fill (and its ordinary 1px seam) is down, so an
    // aggregate polity live this frame can have its own boundary lifted above
    // all of it, in its own colour. The aggregate's fill stays exactly where
    // the loop above left it -- buried under its components, since it sorted
    // first by area -- only the stroke is added here.
    if (this.mode === "outline") {
      for (const d of ordered) {
        const entry = this.polityOf.get(d.versionId);
        if (entry === undefined) continue;
        if (!this.aggregateIds.has(entry.polityId)) continue;
        const path = this.pathFor(d.versionId);
        if (!path) continue;
        ctx.globalAlpha = d.alpha;
        ctx.strokeStyle = this.palette.colourFor(entry.polityId);
        ctx.lineWidth = AGGREGATE_OUTLINE_WIDTH;
        ctx.stroke(path);
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
