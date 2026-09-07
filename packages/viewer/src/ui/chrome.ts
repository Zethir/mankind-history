import { SPEED_STEPS } from "../engine/constants";
import type { Engine } from "../engine/engine";
import type { Frame } from "../engine/frame";

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
  private scrubbing = false;

  constructor(
    root: HTMLElement,
    private readonly engine: Engine,
  ) {
    const [lo, hi] = engine.range;
    root.innerHTML = `
      <div class="bar">
        <button class="play" type="button">Play</button>
        <output class="year"></output>
        <input class="scrub" type="range" min="${lo}" max="${hi + 1}" step="1" value="${lo}" />
        <span class="speeds">
          <button type="button" data-speed="auto">Auto</button>
          ${SPEED_STEPS.map((n) => `<button type="button" data-speed="${n}">${n}x</button>`).join("")}
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
      engine.playing = !engine.playing;
    });

    // While a drag is in progress, update() must not fight the user for the
    // thumb position.
    scrubber.addEventListener("pointerdown", () => {
      this.scrubbing = true;
    });
    scrubber.addEventListener("pointerup", () => {
      this.scrubbing = false;
    });
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
  }
}
