import type { VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { BASE_SPEED } from "../src/engine/constants";
import { Engine } from "../src/engine/engine";

const artifact = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("Engine", () => {
  it("starts paused at the beginning of the range", () => {
    const engine = new Engine(artifact);
    expect(engine.playing).toBe(false);
    expect(engine.clock.year).toBe(engine.range[0]);
  });

  it("does not advance the year while paused", () => {
    const engine = new Engine(artifact);
    const before = engine.clock.year;
    for (let i = 0; i < 100; i++) engine.advance(1 / 60);
    expect(engine.clock.year).toBe(before);
  });

  it("advances while playing and stops at the end of the range", () => {
    const engine = new Engine(artifact);
    engine.playing = true;
    // 200000 frames at 1/60s is over 55 minutes of wall clock -- comfortably
    // enough to cross the fixture's 2774-year range even at reading speed
    // (4 years/s => under 12 minutes). `playing` is set false in exactly one
    // place in Engine (the range-end clamp in advance()), so seeing it false
    // here -- after starting the loop with it forced true -- is proof the
    // range end was actually reached, not merely that the loop ran out.
    for (let i = 0; i < 200000; i++) engine.advance(1 / 60);
    expect(engine.playing).toBe(false);
    expect(engine.clock.year).toBe(engine.range[1] + 1);
  });

  // Without this, `engine.play()` was `engine.playing = true` unconditionally
  // (via chrome.ts's toggle): with the clock already pinned at
  // `range[1] + 1`, the very next advance() call re-clamps the year and
  // clears `playing` again (see advance() above), so playback never actually
  // resumes -- a dead Play button once the timeline has played to the end.
  it("restarts from the beginning when played again after reaching the end", () => {
    const engine = new Engine(artifact);
    engine.clock.year = engine.range[1] + 1;
    engine.playing = false;
    engine.play();
    expect(engine.clock.year).toBe(engine.range[0]);
    expect(engine.playing).toBe(true);
    // And it actually advances afterwards, rather than the clamp firing again
    // on the very next frame.
    const before = engine.clock.year;
    engine.advance(1 / 60);
    expect(engine.clock.year).toBeGreaterThan(before);
    expect(engine.playing).toBe(true);
  });

  it("play() does not seek when playback is not already stopped at the end", () => {
    const engine = new Engine(artifact);
    engine.clock.year = 100;
    engine.play();
    expect(engine.clock.year).toBe(100);
    expect(engine.playing).toBe(true);
  });

  // The finding: `Clock.applied` (what Timeline.activeAt sizes every fade
  // from) is written only by tick/setAuto/setUserSpeed, none of which run
  // while paused. Nothing reset it on pause, on the range-end stop, or on a
  // scrub, so a paused frame kept sizing fades from whatever sprint speed
  // playback last reached -- up to 152.5 y/s measured on the real dataset,
  // widening a version's fade to tens of years and holding it there
  // indefinitely. `engine.pause()` now calls `Clock.resetSpeed()`.
  it("resets speed to reading speed when paused mid-sprint", () => {
    const engine = new Engine(artifact);
    engine.clock.setAuto();
    // Just past where this fixture's Roman Republic rows end; the next
    // change is 407, a gap wide enough for Auto to sprint well past
    // BASE_SPEED (see the -301..407 gap noted below).
    engine.clock.year = -300;
    engine.playing = true;
    for (let i = 0; i < 90; i++) engine.advance(1 / 60);
    // Without the fix this would still be true after pause() too -- confirm
    // we actually reached a sprint before testing the reset.
    expect(engine.clock.speed).toBeGreaterThan(BASE_SPEED * 5);
    engine.pause();
    // Without Clock.resetSpeed(), this stays at whatever the sprint reached
    // (tens of years/second) instead of snapping back to BASE_SPEED (4).
    expect(engine.clock.speed).toBe(BASE_SPEED);
  });

  it("resets speed to reading speed after a seek mid-sprint", () => {
    const engine = new Engine(artifact);
    engine.clock.setAuto();
    engine.clock.year = -300;
    engine.playing = true;
    for (let i = 0; i < 90; i++) engine.advance(1 / 60);
    expect(engine.clock.speed).toBeGreaterThan(BASE_SPEED * 5);
    const frame = engine.seek(0);
    expect(frame.speed).toBe(BASE_SPEED);
    expect(engine.clock.speed).toBe(BASE_SPEED);
  });

  it("seeks to an exact year and reports the frame there", () => {
    const engine = new Engine(artifact);
    // Not year 0: this fixture's real coverage has a gap from -301 (end of the
    // Roman Republic rows) to 407 (start of the Visigoths/Western Roman
    // Empire rows), so year 0 genuinely has zero active versions -- correct
    // per "missing coverage renders as absence", but useless for asserting
    // that seek() surfaces data. Do not "restore" it. -322 is a frame swept
    // and confirmed rich: 2 active versions, both mid-fade, both flashing --
    // so `draws.length > 0` here is backed by a frame known to carry real
    // content, not merely a frame that happens to be non-empty.
    const frame = engine.seek(-322);
    expect(frame.year).toBe(-322);
    expect(frame.draws.length).toBeGreaterThan(0);
  });

  // Task 6's review flagged that Clock.targetSpeed's `remaining <= 0` guard is
  // behaviourally dead when Clock is driven only through Engine: Engine always
  // computes `nextChange` immediately before the tick that consumes it, via
  // ChangeYears.nextChangeAfter(this.clock.year), whose contract guarantees a
  // result strictly greater than the year queried (or null). So through
  // Engine.advance()/seek() alone, `remaining` can never be non-positive.
  //
  // The guard is reachable, though, because Engine exposes `clock` publicly
  // and Clock.tick is itself public: a caller can hand the clock a `nextChange`
  // it did not compute -- exactly a stale cursor. This drives that state
  // directly through Engine's declared public surface (no cast) and checks
  // the caller-facing contract still holds: the year keeps moving forward and
  // the speed never drops below reading speed.
  it("stays sane when handed a stale change cursor (nextChange <= year)", () => {
    const engine = new Engine(artifact);
    engine.clock.setAuto();

    const beforeEqual = engine.clock.year;
    // nextChange === year: remaining is exactly 0.
    engine.clock.tick(1 / 60, engine.clock.year);
    expect(engine.clock.year).toBeGreaterThan(beforeEqual);
    expect(engine.clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);

    const beforeStale = engine.clock.year;
    // nextChange behind year: remaining is negative.
    engine.clock.tick(1 / 60, engine.clock.year - 10);
    expect(engine.clock.year).toBeGreaterThan(beforeStale);
    expect(engine.clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);

    // The engine as a whole keeps working after the perturbation.
    engine.playing = true;
    const beforeResume = engine.clock.year;
    const frame = engine.advance(1 / 60);
    expect(engine.clock.year).toBeGreaterThan(beforeResume);
    expect(frame.year).toBe(engine.clock.year);
  });

  // Acceptance criterion 19. The engine is DOM-free, so its whole behaviour is
  // snapshot-testable without a canvas. Snapshots are committed; a diff here
  // means playback changed, which is sometimes intended and never silent.
  //
  // The brief's original six years (-500, 0, 500, 1000, 1500, 2000) were a
  // rubber stamp against this fixture: four of the six land in genuine data
  // gaps and produce empty frames, and the other two both pin a single
  // version sitting at a flat alpha-1 hold -- so nothing in that set could
  // ever have caught a broken fade ramp, a broken flash envelope, or a wrong
  // active set. These six were instead chosen by sweeping every covered year
  // in the fixture and picking for actual behaviour exercised:
  //   -649:    3 active, 2 mid-fade, 1 flashing -- fade + flash, sparse region
  //   -322:    2 active, 2 mid-fade, 2 flashing -- the only frame with two
  //            simultaneous flashes
  //   410.5:   4 active, 4 mid-fade, 1 flashing -- busiest frame, every
  //            version mid-fade (fractional year: this fixture's integer
  //            years tend to land on hold plateaus, so the ramp only shows
  //            between them)
  //   764:     4 active, 4 mid-fade, 1 flashing -- second busiest, all mid-fade
  //   1938.5:  4 active, 2 mid-fade, 1 flashing -- modern, mixed full and
  //            partial alpha
  //   1000:    0 active -- kept deliberately empty. The project's
  //            non-negotiable is that gaps render as gaps rather than being
  //            papered over, so one frame pinning "the engine returns nothing
  //            where the data says nothing" belongs in this set on purpose.
  it("produces stable frames at fixed years", () => {
    const engine = new Engine(artifact);
    for (const year of [-649, -322, 410.5, 764, 1938.5, 1000]) {
      const frame = engine.seek(year);
      const summary = {
        year: frame.year,
        speed: frame.speed,
        mode: frame.mode,
        count: frame.draws.length,
        draws: frame.draws
          .map((d) => `${d.versionId} a=${d.alpha.toFixed(4)} f=${d.flash.toFixed(4)}`)
          .sort(),
      };
      expect(summary).toMatchSnapshot(`year ${year}`);
    }
  });
});
