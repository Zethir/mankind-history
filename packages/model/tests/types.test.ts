import { describe, expect, it } from "vitest";
import { COORD_SCALE, MAX_SEGMENT_X, PROJECTION, SCHEMA_VERSION } from "../src/canon";
import type { Polity, Version } from "../src/types";

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
    expect(MAX_SEGMENT_X).toBe(2.7);
  });
});
