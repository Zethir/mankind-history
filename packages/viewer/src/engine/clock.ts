import { APPROACH_SECONDS, BASE_SPEED, TAU } from "./constants";
import type { PlaybackMode } from "./frame";

/**
 * Playback speed, per decision 0006 as amended by 0014.
 *
 * Auto is the default and adapts: speed is set so the distance to the next
 * change would be covered in APPROACH_SECONDS, floored at reading speed. The
 * target therefore falls continuously as the event nears and equals BASE_SPEED
 * for the last BASE_SPEED * APPROACH_SECONDS years, which makes "arrive at
 * reading speed" true by construction rather than by tuning.
 *
 * Setting a numeric speed leaves Auto, and that speed is then honoured exactly
 * -- 0006 originally treated it as a floor the system could exceed. See 0014.
 */
export class Clock {
  year: number;
  mode: PlaybackMode = "auto";
  userSpeed = BASE_SPEED;
  private applied = BASE_SPEED;

  constructor(startYear: number) {
    this.year = startYear;
  }

  get speed(): number {
    return this.applied;
  }

  setAuto(): void {
    this.mode = "auto";
    // Returning from a manual speed below reading speed would otherwise leave
    // `applied` under BASE_SPEED until smoothing caught up, transiently
    // breaking the "auto never drags below reading speed" invariant.
    if (this.applied < BASE_SPEED) this.applied = BASE_SPEED;
  }

  setUserSpeed(speed: number): void {
    this.mode = "manual";
    this.userSpeed = speed;
    this.applied = speed;
  }

  tick(dt: number, nextChange: number | null): void {
    const target = this.targetSpeed(nextChange);
    if (this.mode === "manual" || target <= this.applied) {
      // Deceleration is immediate. That is not a jolt: in auto the target
      // falls continuously as the event nears, so `applied` simply tracks it.
      this.applied = target;
    } else {
      // Acceleration is smoothed, because the target does jump upward the
      // instant a change year is passed.
      this.applied += (target - this.applied) * (1 - Math.exp(-dt / TAU));
    }
    this.year += this.applied * dt;
  }

  private targetSpeed(nextChange: number | null): number {
    if (this.mode === "manual") return this.userSpeed;
    if (nextChange === null) return BASE_SPEED;
    const remaining = nextChange - this.year;
    if (remaining <= 0) return BASE_SPEED;
    return Math.max(BASE_SPEED, remaining / APPROACH_SECONDS);
  }
}
