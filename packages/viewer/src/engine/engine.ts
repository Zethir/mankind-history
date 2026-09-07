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
        this.playing = false;
      }
    }
    return this.frame();
  }

  seek(year: number): Frame {
    this.clock.year = Math.min(Math.max(year, this.range[0]), this.range[1] + 1);
    return this.frame();
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
