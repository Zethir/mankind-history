import { SPEED_STEPS } from "../engine/constants";
import type { Engine } from "../engine/engine";
import type { Frame } from "../engine/frame";
import type { MapRenderer } from "../render/canvas";
import type { RenderMode } from "../render/render-mode";

/**
 * Labelled by effect, not mechanism, so the owner can pick a mode without
 * reading render-mode.ts: "Off" is today's behaviour (the baseline being
 * compared against), "Outline" draws the empire's boundary over its
 * already-coloured components, and "Merged" is the one that actually answers
 * the motivating question -- French Africa and metropolitan France sharing a
 * colour -- by having every component borrow its aggregate's colour.
 */
const MODE_LABELS: Record<RenderMode, string> = {
  none: "Off",
  outline: "Outline",
  parent: "Merged",
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

export class Chrome {
  private readonly readout: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly scrubber: HTMLInputElement;
  private readonly speeds = new Map<string, HTMLButtonElement>();
  private readonly modes = new Map<RenderMode, HTMLButtonElement>();
  private scrubbing = false;
  private resumeAfterScrub = false;

  constructor(
    root: HTMLElement,
    private readonly engine: Engine,
    private readonly renderer: MapRenderer,
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
    if (!readout || !play || !scrubber) throw new Error("chrome failed to build");
    this.readout = readout;
    this.play = play;
    this.scrubber = scrubber;

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
  }
}
