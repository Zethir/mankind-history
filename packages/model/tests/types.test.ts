import { describe, expect, it } from "vitest";
import {
  COORD_SCALE,
  GRID,
  MAX_SEGMENT_X,
  PROJECTION,
  PX_PER_UNIT,
  SCHEMA_VERSION,
  WORLD_HALF_HEIGHT,
} from "../src/canon";
import type { ChangesArtifact, Polity, Version } from "../src/types";

describe("canonical types", () => {
  it("a Version carries every lineage field the expansion flash depends on", () => {
    // Decision 0004 requires prevId, delta and gap on every version.
    const version: Version = {
      id: "wd:Q1747689@-27",
      polityId: "wd:Q1747689",
      fromYear: -27,
      toYear: 180,
      area: 4200000,
      prevId: null,
      delta: null,
      gap: null,
      confidence: null,
      source: { dataset: "cliopatria", version: "1.0.0" },
    };
    expect(version.id).toBe("wd:Q1747689@-27");
    expect(version.confidence).toBeNull();
  });

  it("a Polity carries the three reference identifiers decision 0007 stores", () => {
    const polity: Polity = {
      id: "wd:Q1747689",
      name: "Roman Empire",
      normalizedName: "roman-empire",
      wikidata: "Q1747689",
      wikipedia: "Roman_Empire",
      seshat: "12",
    };
    expect(polity.normalizedName).toBe("roman-empire");
  });

  it("pins the constants the artifact contract depends on", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(PROJECTION).toBe("equal-earth");
    expect(COORD_SCALE.full).toBe(1e9);
    expect(COORD_SCALE.mid).toBe(1e6);
    expect(COORD_SCALE.coarse).toBe(1e5);
    expect(MAX_SEGMENT_X).toBe(4.0);
  });

  it("pins the grid and viewport constants the change index depends on", () => {
    expect(GRID.cols).toBe(64);
    expect(GRID.rows).toBe(32);
    // Half the projected world height: y at lat 90.
    expect(WORLD_HALF_HEIGHT).toBeCloseTo(1.31736, 5);
    // Provisional Phase 2 viewport assumptions -- a 1400px-wide window showing
    // the whole world at coarse, an eighth of it at mid, a sixty-fourth at full.
    expect(PX_PER_UNIT.coarse).toBe(259);
    expect(PX_PER_UNIT.mid).toBe(2069);
    expect(PX_PER_UNIT.full).toBe(16552);
  });

  it("a ChangesArtifact carries a row-major grid of sorted year lists", () => {
    const changes: ChangesArtifact = {
      schemaVersion: 1,
      grid: { cols: 2, rows: 1, bounds: [-1, -1, 1, 1] },
      cells: [[-200, 14], [476]],
    };
    expect(changes.cells).toHaveLength(2);
    expect(changes.grid.bounds[2]).toBe(1);
  });
});
