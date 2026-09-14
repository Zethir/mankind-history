import type { LandArtifact, Polygon, VersionsArtifact } from "@history/model";
import type { Frame } from "../engine/frame";
import { buildAggregateParents, buildPalette, type Palette, resolveAggregateRoot } from "./palette";
import { buildPolityIndex, type PolityIndexEntry } from "./polity-index";
import { colourForDraw, type RenderMode } from "./render-mode";
import { fitWorld, panBy, type Viewport } from "./transform";

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
 * land on the same palette colour (the hash-assigned population can collide
 * by chance, and in "on" mode every member of one empire shares its
 * aggregate's exact colour by design -- see docs/decisions/0019) read as
 * separate shapes instead of merging into one blob. Darker than both ground
 * tones -- LAND is #2b3440, SEA is #101b26 -- so it reads as a seam on every
 * fill, including the darkest palette lightness band, rather than
 * disappearing into the plate the way a mid-tone stroke would over SEA.
 * Also the empire-boundary stroke's colour (see `AGGREGATE_OUTLINE_WIDTH`):
 * a same-colour-as-fill boundary would be invisible exactly where it matters
 * most, an unrelated neighbour sharing the empire's colour.
 */
const OUTLINE = "#04070a";

/** Ordinary per-polity outline width: internal divisions, not the point. */
const POLITY_OUTLINE_WIDTH = 0.75;

/**
 * The empire boundary: drawn over every live aggregate's shape in "on" mode
 * (docs/decisions/0019), in the same dark `OUTLINE` colour as the ordinary
 * per-polity seam, just heavier -- twice `POLITY_OUTLINE_WIDTH`, so the
 * hierarchy ("this line is a member boundary" vs. "this line is the empire's
 * edge") reads from the ratio between the two rather than from either one's
 * absolute weight. The owner called a 3px stroke (this project's very first
 * attempt) "super thick"; 1.5px against a 0.75px ordinary seam is
 * perceptibly heavier without being thick in its own right.
 *
 * Judged and accepted on the deployed map at the close of Milestone 2, after
 * the owner had flagged it as possibly still slightly thick in Milestone 1.
 * It is no longer an untested guess, so do not re-derive it from the ratio
 * argument above: that argument is why 1.5 was proposed, not why it stands.
 */
const AGGREGATE_OUTLINE_WIDTH = 1.5;

export class MapRenderer {
  readonly viewport: Viewport;
  /**
   * Whether aggregate polities render merged with their members
   * (render-mode.ts). Public and mutable, read directly by draw() every
   * frame, so the chrome's control can set it and read it back with no
   * shadow state of its own -- the same pattern engine.playing and
   * clock.userSpeed already use. Defaults to "on": merged fill plus empire
   * boundary is the shipped behaviour, not an experiment; "off" stays
   * available so the owner can still compare against the pre-change
   * baseline.
   */
  mode: RenderMode = "on";
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paths = new Map<string, Path2D>();
  private readonly polityOf: Map<string, PolityIndexEntry>;
  private readonly areaOf = new Map<string, number>();
  private readonly knownPolityIds: ReadonlySet<string>;
  /**
   * Root aggregate polity ids -- every version's memberOf, resolved
   * transitively to its root (`resolveAggregateRoot`, palette.ts) -- so a
   * nested aggregate that is itself a member (Kingdom of Bohemia -> Holy
   * Roman Empire) contributes its root, not itself, keeping this set
   * consistent with the root-resolved colour every member of that group
   * shares. See draw().
   */
  private readonly aggregateIds: ReadonlySet<string>;
  private readonly aggregateParents: ReadonlyMap<string, string>;
  private readonly palette: Palette;
  private landPath: Path2D | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private versions: VersionsArtifact,
    private land: LandArtifact,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.polityOf = buildPolityIndex(versions);
    this.palette = buildPalette(versions);
    this.aggregateParents = buildAggregateParents(versions);
    const knownPolityIds = new Set<string>();
    const aggregateIds = new Set<string>();
    for (const r of versions.rows) {
      this.areaOf.set(r.id, r.area);
      knownPolityIds.add(r.polityId);
      if (r.memberOf !== null) {
        aggregateIds.add(resolveAggregateRoot(r.memberOf, this.aggregateParents));
      }
    }
    this.knownPolityIds = knownPolityIds;
    this.aggregateIds = aggregateIds;
    this.viewport = fitWorld(canvas.clientWidth, canvas.clientHeight);
    this.resize();
  }

  /**
   * Resizes the backing store and re-clamps, without discarding the user's
   * centre or zoom -- a window resize must not silently reset the view back
   * to `fitWorld` now that interaction exists (it was harmless to do so
   * before this task, when the viewport never moved from fit in the first
   * place). Only what genuinely depends on canvas size changes: the backing
   * store, width/height, and the clamp, since a smaller canvas can raise the
   * minimum scale and shrink the pan limits. Reclamping goes through
   * `panBy`'s shared `clamp()` (a zero-distance pan) rather than a second
   * clamp implementation of this file's own.
   */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const resized = panBy({ ...this.viewport, width, height }, 0, 0);
    Object.assign(this.viewport, resized);
    // Paths are built in world space (projected units), so they are valid for
    // every viewport -- a resize only changes fit-to-window scale and the
    // canvas's backing size, neither of which the cache depends on. It is
    // cleared on a level switch instead, in setVersions below.
  }

  setViewport(v: Viewport): void {
    Object.assign(this.viewport, v);
  }

  /**
   * Swaps in a finer (or coarser -- never happens in practice, but nothing
   * here assumes otherwise) detail level's geometry. Only the geometry
   * source and the path cache change: `areaOf`, `knownPolityIds`,
   * `aggregateIds` and `aggregateParents` are built from `rows`, and every
   * detail level's `rows` are byte-identical (verified against
   * fixtures/dist: only `coordScale` and vertex values differ across
   * versions.0/1/2.json) -- rebuilding them here would be wasted work, not
   * a correctness fix.
   *
   * The path cache must be cleared, though: a cached Path2D was built at the
   * old artifact's `coordScale`, and drawing it against the new one's scale
   * (1e5 vs 1e9, coarse to full) would render a map orders of magnitude too
   * small.
   */
  setVersions(artifact: VersionsArtifact): void {
    this.versions = artifact;
    this.paths.clear();
  }

  /** Swaps in a finer land basemap. Mirrors setVersions for the one path it caches. */
  setLand(artifact: LandArtifact): void {
    this.land = artifact;
    this.landPath = null;
  }

  draw(frame: Frame): void {
    const ctx = this.ctx;
    const { viewport } = this;

    // The sea covers the canvas, not the world, so it is filled in screen
    // space -- CSS pixels scaled to the device pixel ratio, with no world
    // transform -- before the world transform below is set, or it would pan
    // and zoom away from the canvas edges.
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    // World -> screen, with Y flipped, then device pixels. Everything drawn
    // after this is in projected units.
    ctx.setTransform(
      dpr * viewport.scale,
      0,
      0,
      -dpr * viewport.scale,
      dpr * (viewport.width / 2 - viewport.centreX * viewport.scale),
      dpr * (viewport.height / 2 + viewport.centreY * viewport.scale),
    );

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
      ctx.fillStyle = colourForDraw(
        entry,
        this.mode,
        this.palette,
        this.knownPolityIds,
        this.aggregateParents,
      );
      ctx.fill(path);
      // Same globalAlpha as the fill, so the outline fades with the version
      // rather than persisting as a solid line after the shape has faded out.
      ctx.strokeStyle = OUTLINE;
      // Widths are screen pixels but the transform is in projected units. One
      // world unit is dpr*scale device pixels and a W-pixel stroke is W*dpr
      // device pixels, so lineWidth is W/scale -- the dpr cancels. Without
      // this, borders thicken as you zoom until the map is all outline.
      ctx.lineWidth = POLITY_OUTLINE_WIDTH / viewport.scale;
      ctx.stroke(path);
      if (d.flash > 0) {
        ctx.globalAlpha = d.alpha * d.flash * 0.55;
        ctx.fillStyle = FLASH;
        ctx.fill(path);
      }
    }

    // "on" mode: every fill (and its ordinary seam) is down, including every
    // member merged into its aggregate's colour, so an aggregate polity live
    // this frame can have its own boundary lifted above all of it, in the
    // same dark OUTLINE colour as the ordinary seam -- never the empire's own
    // fill colour, which would be invisible exactly where a neighbour shares
    // it. The aggregate's fill stays exactly where the loop above left it --
    // buried under its components, since it sorted first by area -- only the
    // stroke is added here.
    if (this.mode === "on") {
      for (const d of ordered) {
        const entry = this.polityOf.get(d.versionId);
        if (entry === undefined) continue;
        if (!this.aggregateIds.has(entry.polityId)) continue;
        const path = this.pathFor(d.versionId);
        if (!path) continue;
        ctx.globalAlpha = d.alpha;
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = AGGREGATE_OUTLINE_WIDTH / viewport.scale;
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

  /**
   * Built in world space (projected units, Y not flipped), so the path is
   * valid for every viewport -- pan and zoom are applied once as a canvas
   * transform in draw(), not baked into each vertex. See decision 0002.
   */
  private buildPath(polygons: readonly Polygon[], coordScale: number): Path2D {
    const path = new Path2D();
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const x = (ring[i] as number) / coordScale;
          const y = (ring[i + 1] as number) / coordScale;
          if (i === 0) path.moveTo(x, y);
          else path.lineTo(x, y);
        }
        path.closePath();
      }
    }
    return path;
  }
}
