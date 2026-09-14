import { bestAvailable, type LevelRegistry } from "../data/levels";
import { SPEED_STEPS } from "../engine/constants";
import type { Engine } from "../engine/engine";
import type { Frame } from "../engine/frame";
import type { MapRenderer } from "../render/canvas";
import type { DetailLevel } from "../render/level";
import type { RenderMode } from "../render/render-mode";
import { fitWorld, panBy, wheelZoomFactor, zoomAt } from "../render/transform";

/**
 * Labelled by effect, not mechanism, so the owner can pick a mode without
 * reading render-mode.ts. "Off" is the pre-change baseline, kept only for
 * comparison. "Merged" is the shipped behaviour: every component takes its
 * aggregate's colour, with the empire's boundary stroked over the top --
 * see docs/decisions/0019-merged-fill-with-boundary.md.
 */
const MODE_LABELS: Record<RenderMode, string> = {
  off: "Off",
  on: "Merged",
};

/**
 * Years are negative for BCE in the artifact contract. The readout is
 * deliberately the most prominent thing here: per decision 0006 the racing
 * year is the ONLY signal that playback is accelerating. An explicit skip
 * marker was considered and rejected.
 */
function formatYear(year: number): string {
  const y = Math.floor(year);
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}

const LEVEL_LABELS: Record<DetailLevel, string> = {
  coarse: "Coarse",
  mid: "Mid",
  full: "Full",
};

/** The next-finer level above `level`, or null once already at full. */
function finerThan(level: DetailLevel): DetailLevel | null {
  if (level === "coarse") return "mid";
  if (level === "mid") return "full";
  return null;
}

export class Chrome {
  private readonly readout: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly level: HTMLElement;
  private readonly speeds = new Map<string, HTMLButtonElement>();
  private readonly modes = new Map<RenderMode, HTMLButtonElement>();
  private scrubbing = false;
  private resumeAfterScrub = false;

  constructor(
    root: HTMLElement,
    private readonly engine: Engine,
    private readonly renderer: MapRenderer,
    canvas: HTMLCanvasElement,
    private readonly registry: LevelRegistry,
  ) {
    const [lo, hi] = engine.range;
    root.innerHTML = `
      <div class="bar">
        <button class="play" type="button">Play</button>
        <output class="year"></output>
        <input class="scrub" type="range" min="${lo}" max="${hi + 1}" step="1" value="${lo}" />
        <span class="speeds">
          <button type="button" data-speed="auto">Auto</button>
          ${SPEED_STEPS.map((n) => `<button type="button" data-speed="${n}">${n}x</button>`).join(
            "",
          )}
        </span>
        <span class="modes">
          <span class="modes-label">Empires:</span>
          ${(Object.keys(MODE_LABELS) as RenderMode[])
            .map((m) => `<button type="button" data-mode="${m}">${MODE_LABELS[m]}</button>`)
            .join("")}
        </span>
        <output class="level"></output>
        <button class="reset" type="button">Reset</button>
      </div>
      <p class="note">
        Coastlines are modern. Over this range shorelines move: the Aral Sea, the
        Dutch coast and the head of the Persian Gulf are the exceptions worth naming.
      </p>
      <p class="credit">
        Territory from <a href="https://doi.org/10.5281/zenodo.13363121">Cliopatria</a>,
        Seshat Global History Databank (Turchin et al.), CC-BY.
        Land from <a href="https://www.naturalearthdata.com/">Natural Earth</a>, public domain.
      </p>
    `;

    const readout = root.querySelector<HTMLElement>(".year");
    const play = root.querySelector<HTMLButtonElement>(".play");
    const scrubber = root.querySelector<HTMLInputElement>(".scrub");
    const level = root.querySelector<HTMLElement>(".level");
    const reset = root.querySelector<HTMLButtonElement>(".reset");
    if (!readout || !play || !scrubber || !level || !reset) {
      throw new Error("chrome failed to build");
    }
    this.readout = readout;
    this.play = play;
    this.scrubber = scrubber;
    this.level = level;

    // Reads the renderer's actual viewport back via fitWorld rather than
    // keeping a remembered "original" viewport of its own -- the same
    // no-shadow-state rule every other control here follows. fitWorld's
    // width/height are the only inputs it needs, and the viewport already
    // holds them.
    reset.addEventListener("click", () => {
      renderer.setViewport(fitWorld(renderer.viewport.width, renderer.viewport.height));
    });

    // Wheel zooms about the cursor. preventDefault plus { passive: false } is
    // required together: without the listener option the browser ignores the
    // call and scrolls the page under the map instead of zooming it.
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const sx = event.clientX - rect.left;
        const sy = event.clientY - rect.top;
        const factor = wheelZoomFactor(event.deltaY, event.deltaMode, event.ctrlKey);
        renderer.setViewport(zoomAt(renderer.viewport, factor, sx, sy));
      },
      { passive: false },
    );

    // Drag pans. Pointer capture keeps receiving move events even if the
    // cursor leaves the canvas mid-drag, and the drag state resets on
    // pointercancel as well as pointerup -- Milestone 1 shipped a stuck-
    // scrubber bug from exactly that omission on the scrub input (see
    // endScrub below); this is the same fix applied to the drag gesture.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener("pointerdown", (event) => {
      // button 0 is the primary button (left, on a standard mouse). Without
      // this check, a right-click drag would pan the map and hold pointer
      // capture while the context menu is trying to open.
      if (event.button !== 0) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.setViewport(panBy(renderer.viewport, dx, dy));
    });
    const endDrag = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    play.addEventListener("click", () => {
      if (engine.playing) engine.pause();
      else engine.play();
    });

    // While a drag is in progress, update() must not fight the user for the
    // thumb position. Playback is also paused for the duration of the drag
    // and resumed on release: without that, engine.advance() and the drag's
    // own engine.seek() calls would both be writing clock.year every frame,
    // racing each other. Resuming automatically on release is a judgement
    // call standard media scrubbers make; the feel session may revisit it.
    scrubber.addEventListener("pointerdown", () => {
      this.scrubbing = true;
      this.resumeAfterScrub = engine.playing;
      engine.pause();
    });
    // The release listeners live on window, not the input: a pointer
    // sequence that ends outside the element (or is cancelled by the OS,
    // e.g. a touch interrupted by a context menu) never fires pointerup on
    // the input itself, which would otherwise leave `scrubbing` stuck true
    // and freeze the thumb against further playback updates.
    const endScrub = (): void => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      if (this.resumeAfterScrub) {
        this.resumeAfterScrub = false;
        // engine.play(), not `engine.playing = true`: a scrub that lands
        // exactly on the range end is the same dead-end shape as the play
        // button at the end (see Engine.play()) -- dragging to the end while
        // already playing, then releasing, must rewind before resuming
        // rather than resume into the clamp that immediately re-stops it.
        engine.play();
      }
    };
    window.addEventListener("pointerup", endScrub);
    window.addEventListener("pointercancel", endScrub);
    scrubber.addEventListener("input", () => {
      engine.seek(Number(scrubber.value));
    });

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      const value = button.dataset.speed as string;
      this.speeds.set(value, button);
      button.addEventListener("click", () => {
        if (value === "auto") engine.clock.setAuto();
        else engine.clock.setUserSpeed(Number(value));
      });
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      const value = button.dataset.mode as RenderMode;
      this.modes.set(value, button);
      button.addEventListener("click", () => {
        renderer.mode = value;
      });
    }
  }

  /**
   * Reads its state from the frame rather than tracking its own, so the
   * control can never disagree with the engine about what is happening.
   */
  update(frame: Frame): void {
    this.readout.textContent = formatYear(frame.year);
    this.play.textContent = this.engine.playing ? "Pause" : "Play";
    if (!this.scrubbing) this.scrubber.value = String(Math.floor(frame.year));
    const active = frame.mode === "auto" ? "auto" : String(this.engine.clock.userSpeed);
    for (const [value, button] of this.speeds) {
      button.classList.toggle("on", value === active);
    }
    for (const [value, button] of this.modes) {
      button.classList.toggle("on", value === this.renderer.mode);
    }

    // The owner needs to tell "this is coarse because it is still loading" from
    // "this is coarse and that is all there is" -- bestAvailable alone cannot
    // distinguish those, so a finer level's own load state is checked directly.
    const current = bestAvailable(this.registry);
    const next = finerThan(current);
    if (next !== null && this.registry.stateOf(next) === "loading") {
      this.level.textContent = `${LEVEL_LABELS[current]} (loading ${LEVEL_LABELS[next].toLowerCase()}...)`;
    } else {
      this.level.textContent = LEVEL_LABELS[current];
    }
  }
}
