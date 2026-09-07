import { describe, expect, it } from "vitest";
import { Clock } from "../src/engine/clock";
import { APPROACH_SECONDS, BASE_SPEED } from "../src/engine/constants";

const DT = 1 / 120;

/** Runs a clock across one gap and reports how long the crossing took. */
function crossGap(gap: number): { seconds: number; arrivalSpeed: number } {
  const clock = new Clock(0);
  const target = gap;
  let t = 0;
  while (clock.year < target && t < 300) {
    clock.tick(DT, target);
    t += DT;
  }
  return { seconds: t, arrivalSpeed: clock.speed };
}

describe("Clock in manual mode", () => {
  // Acceptance criterion 1. This is the amendment to decision 0006, which made
  // the user's setting a floor the system was free to exceed. A regression
  // here is silent, which is why it is asserted at every tick.
  it("honours the set speed exactly and never exceeds it", () => {
    for (const speed of [1, 2, 4, 8, 16]) {
      const clock = new Clock(0);
      clock.setUserSpeed(speed);
      expect(clock.mode).toBe("manual");
      for (let i = 0; i < 2000; i++) {
        // A change 500 years away is exactly the situation Auto would sprint
        // through. Manual must not.
        clock.tick(DT, 500);
        expect(clock.speed).toBe(speed);
      }
      expect(clock.year).toBeCloseTo(speed * 2000 * DT, 6);
    }
  });
});

describe("Clock in auto mode", () => {
  it("defaults to auto at reading speed", () => {
    const clock = new Clock(0);
    expect(clock.mode).toBe("auto");
    clock.tick(DT, 1);
    expect(clock.speed).toBe(BASE_SPEED);
  });

  // Acceptance criterion 2.
  it("never drops below reading speed", () => {
    const clock = new Clock(0);
    for (let i = 0; i < 5000; i++) {
      clock.tick(DT, clock.year + ((i % 400) + 1));
      expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    }
  });

  // Acceptance criterion 3. True by construction: the target equals BASE_SPEED
  // for the last BASE_SPEED * APPROACH_SECONDS years, and deceleration is
  // applied immediately rather than smoothed.
  it("arrives at exactly reading speed, from any gap", () => {
    for (const gap of [5, 14, 50, 100, 300]) {
      expect(crossGap(gap).arrivalSpeed).toBe(BASE_SPEED);
    }
  });

  // Acceptance criterion 4. The simulation is the oracle; the closed form is
  // not what the implementation computes.
  it("closes a gap within the logarithmic dead-time bound", () => {
    for (const gap of [5, 14, 50, 100, 300]) {
      const floor = BASE_SPEED * APPROACH_SECONDS;
      const bound =
        gap <= floor
          ? gap / BASE_SPEED + 0.5
          : APPROACH_SECONDS * (1 + Math.log(gap / floor)) + 0.5;
      expect(crossGap(gap).seconds, `gap ${gap}`).toBeLessThanOrEqual(bound);
    }
  });

  it("closes the dataset's largest gap inside Phase 0's dead-time range", () => {
    const { seconds } = crossGap(300);
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(10);
  });

  // Acceptance criterion 5.
  it("never moves the year backwards", () => {
    const clock = new Clock(-3400);
    let prev = clock.year;
    for (let i = 0; i < 20000; i++) {
      clock.tick(DT, clock.year + ((i * 7) % 300) + 1);
      expect(clock.year).toBeGreaterThanOrEqual(prev);
      prev = clock.year;
    }
  });

  it("returns to auto after a manual setting", () => {
    const clock = new Clock(0);
    clock.setUserSpeed(1);
    expect(clock.mode).toBe("manual");
    clock.setAuto();
    expect(clock.mode).toBe("auto");
    // Criterion 2 must hold from the very first tick after the switch, not
    // once smoothing has caught up from the slower manual speed.
    expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    for (let i = 0; i < 400; i++) {
      clock.tick(DT, 500);
      expect(clock.speed).toBeGreaterThanOrEqual(BASE_SPEED);
    }
    expect(clock.speed).toBeGreaterThan(BASE_SPEED);
  });

  it("holds reading speed when nothing is left to reach", () => {
    const clock = new Clock(0);
    for (let i = 0; i < 200; i++) clock.tick(DT, null);
    expect(clock.speed).toBe(BASE_SPEED);
  });
});
