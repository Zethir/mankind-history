import type { VersionsArtifact } from "@history/model";
import { ChangeYears } from "./change-years";
import { Clock } from "./clock";
import type { Frame } from "./frame";
import { Timeline } from "./timeline";

/**
 * Composes the timeline, the change years and the clock into a Frame. The
 * whole of what the renderer sees.
 */
export class Engine {
  readonly clock: Clock;
  readonly range: readonly [number, number];
  playing = false;
  private readonly timeline: Timeline;
  private readonly changes: ChangeYears;

  constructor(artifact: VersionsArtifact) {
    this.timeline = new Timeline(artifact);
    this.changes = new ChangeYears(artifact.rows);
    this.range = this.timeline.range;
    this.clock = new Clock(this.range[0]);
  }

  advance(dt: number): Frame {
    if (this.playing) {
      this.clock.tick(dt, this.changes.nextChangeAfter(this.clock.year));
      if (this.clock.year >= this.range[1] + 1) {
        this.clock.year = this.range[1] + 1;
        this.pause();
      }
    }
    return this.frame();
  }

  seek(year: number): Frame {
    this.clock.year = Math.min(Math.max(year, this.range[0]), this.range[1] + 1);
    // A seek jumps time discontinuously, so whatever speed the clock was
    // carrying (e.g. mid-sprint) no longer describes what is about to happen.
    // Without this, fades sized from that stale speed would outlive it. See
    // Clock.resetSpeed.
    this.clock.resetSpeed();
    return this.frame();
  }

  /**
   * Stops playback and resets the clock's speed to its mode's base, so a
   * paused frame's fade width reflects reading speed rather than whatever
   * sprint was in progress when playback stopped.
   */
  pause(): void {
    this.playing = false;
    this.clock.resetSpeed();
  }

  /**
   * Starts playback. Playback that reached the end of the range clamps the
   * year there and clears `playing` (see advance()) -- clicking play again
   * without first seeking would otherwise immediately re-clamp and re-clear
   * it, a dead button. Restart from the beginning in that case instead.
   */
  play(): void {
    if (!this.playing && this.clock.year >= this.range[1] + 1) {
      this.seek(this.range[0]);
    }
    this.playing = true;
  }

  frame(): Frame {
    return {
      year: this.clock.year,
      speed: this.clock.speed,
      mode: this.clock.mode,
      draws: this.timeline.activeAt(this.clock.year, this.clock.speed),
    };
  }
}
