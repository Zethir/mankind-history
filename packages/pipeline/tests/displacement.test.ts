import { describe, expect, it } from "vitest";
import { measureDisplacement } from "../src/stages/displacement";

const FIXTURES = "fixtures/dist";

describe("measureDisplacement", () => {
  it("reports arcs and displacements for the fixture at coarse", () => {
    const r = measureDisplacement(FIXTURES, "coarse");
    // The fixture is a thin slice -- 620 shared arcs against the full build's
    // 22,215 -- so this asserts shape, not statistics.
    expect(r.arcsConsidered).toBeGreaterThan(0);
    expect(r.identical + r.droppedArcs).toBeLessThanOrEqual(r.arcsConsidered);
    for (const d of r.displacements) expect(d).toBeGreaterThanOrEqual(0);
  });

  it("returns displacements sorted ascending, so percentiles are index lookups", () => {
    const r = measureDisplacement(FIXTURES, "coarse");
    for (let i = 1; i < r.displacements.length; i++) {
      expect(r.displacements[i] as number).toBeGreaterThanOrEqual(r.displacements[i - 1] as number);
    }
  });

  it("measures mid as a strictly less simplified level than coarse", () => {
    // Not a statistical claim about the fixture: mid retains 60% of vertices
    // against coarse's 30%, so it cannot drop MORE arcs than coarse does.
    const coarse = measureDisplacement(FIXTURES, "coarse");
    const mid = measureDisplacement(FIXTURES, "mid");
    expect(mid.droppedArcs).toBeLessThanOrEqual(coarse.droppedArcs);
  });
});
