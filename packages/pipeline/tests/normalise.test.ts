import { describe, expect, it } from "vitest";
import {
  normaliseCliopatria,
  normaliseLand,
  toWikidata,
  toWikipedia,
  toYear,
} from "../src/stages/normalise";

const square = (cx: number, cy: number) => [
  [cx, cy],
  [cx + 1, cy],
  [cx + 1, cy + 1],
  [cx, cy + 1],
  [cx, cy],
];

function polity(props: Record<string, unknown>, coordinates: unknown = [square(0, 0)]) {
  return {
    type: "Feature",
    properties: { Type: "POLITY", Name: "Test", FromYear: 0, ToYear: 100, Area: 1, ...props },
    geometry: { type: "Polygon", coordinates },
  };
}

describe("toYear", () => {
  it("accepts integers, including negative ones for BCE", () => {
    expect(toYear(-200)).toBe(-200);
  });
  it("coerces the string years some rows arrive with", () => {
    expect(toYear(" -200 ")).toBe(-200);
    expect(toYear("1492")).toBe(1492);
  });
  it("rejects unusable values", () => {
    expect(toYear(null)).toBeNull();
    expect(toYear("")).toBeNull();
    expect(toYear("oops")).toBeNull();
  });
});

describe("toWikidata", () => {
  it("accepts a bare Q-id and a full URL", () => {
    expect(toWikidata("Q1747689")).toBe("Q1747689");
    expect(toWikidata("https://www.wikidata.org/wiki/Q1747689")).toBe("Q1747689");
  });
  it("returns null for anything that is not a Q-id", () => {
    expect(toWikidata("")).toBeNull();
    expect(toWikidata("n/a")).toBeNull();
    expect(toWikidata(null)).toBeNull();
  });
});

describe("toWikipedia", () => {
  it("normalises titles, slugs and URLs to one underscore form", () => {
    expect(toWikipedia("Roman Empire")).toBe("Roman_Empire");
    expect(toWikipedia("Roman_Empire")).toBe("Roman_Empire");
    expect(toWikipedia("https://en.wikipedia.org/wiki/Roman_Empire")).toBe("Roman_Empire");
    expect(toWikipedia("https://en.wikipedia.org/wiki/C%C3%B4te_d%27Ivoire")).toBe(
      "C\u00f4te_d'Ivoire",
    );
  });
  it("returns null when empty", () => {
    expect(toWikipedia("  ")).toBeNull();
  });
});

describe("normaliseCliopatria", () => {
  it("drops non-POLITY rows and counts them (decision 0008)", () => {
    const { rows, report } = normaliseCliopatria([
      polity({}),
      { ...polity({}), properties: { Type: "RELATION", Name: "R", FromYear: 0, ToYear: 1 } },
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedNonPolity).toBe(1);
  });

  it("drops rows with unusable or inverted years and counts them", () => {
    const { rows, report } = normaliseCliopatria([
      polity({ FromYear: null }),
      polity({ ToYear: "oops" }),
      polity({ FromYear: 500, ToYear: 100 }),
      polity({}),
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedYears).toBe(3);
  });

  it("drops rows whose geometry yields no usable ring and counts them", () => {
    const { rows, report } = normaliseCliopatria([
      polity({}, [
        [
          [0, 0],
          [1, 1],
        ],
      ]),
      polity({}, [
        [
          [0, 0],
          [1, 0],
          [Number.NaN, 1],
          [0, 0],
        ],
      ]),
      polity({}),
    ]);
    expect(rows).toHaveLength(1);
    expect(report.droppedGeometry).toBe(2);
  });

  it("closes an unclosed ring and counts it, rather than emitting an open ring", () => {
    const open = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const { rows, report } = normaliseCliopatria([polity({}, [open])]);
    const ring = rows[0]?.polygons[0]?.[0];
    expect(ring).toHaveLength(5);
    expect(ring?.[4]).toEqual([0, 0]);
    expect(report.closedRings).toBe(1);
  });

  it("keeps every ring of a MultiPolygon, holes included", () => {
    const feature = {
      type: "Feature",
      properties: { Type: "POLITY", Name: "M", FromYear: 0, ToYear: 1, Area: 2 },
      geometry: {
        type: "MultiPolygon",
        coordinates: [[square(0, 0), square(0, 0)], [square(10, 10)]],
      },
    };
    const { rows } = normaliseCliopatria([feature]);
    expect(rows[0]?.polygons).toHaveLength(2);
    expect(rows[0]?.polygons[0]).toHaveLength(2);
  });

  it("carries the reference identifiers through", () => {
    const { rows } = normaliseCliopatria([
      polity({
        Name: "Roman Empire",
        Wikidata: "Q1747689",
        Wikipedia: "Roman Empire",
        SeshatID: 12,
      }),
    ]);
    expect(rows[0]).toMatchObject({
      name: "Roman Empire",
      wikidata: "Q1747689",
      wikipedia: "Roman_Empire",
      seshat: "12",
    });
  });

  it("counts a discarded MultiPolygon part rather than losing it silently", () => {
    const feature = {
      type: "Feature",
      properties: { Type: "POLITY", Name: "Archipelago", FromYear: 0, ToYear: 1, Area: 2 },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [square(0, 0)],
          [
            [
              [0, 0],
              [1, 1],
            ],
          ],
          [square(10, 10)],
        ],
      },
    };
    const { rows, report } = normaliseCliopatria([feature]);
    expect(rows[0]?.polygons).toHaveLength(2);
    expect(report.kept).toBe(1);
    expect(report.droppedParts).toBe(1);
  });
});

describe("normaliseLand", () => {
  it("flattens Natural Earth features into a flat polygon list", () => {
    const { polygons } = normaliseLand([
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [square(0, 0)] },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[square(5, 5)], [square(9, 9)]] },
      },
    ]);
    expect(polygons).toHaveLength(3);
  });

  it("counts kept features rather than polygons, so the counters reconcile to the input", () => {
    const { polygons, report } = normaliseLand([
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [square(0, 0)] },
      },
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[square(5, 5)], [square(9, 9)]] },
      },
      { type: "Feature", properties: {}, geometry: null },
    ]);
    expect(polygons).toHaveLength(3);
    expect(report.kept).toBe(2);
    expect(report.droppedGeometry).toBe(1);
    expect(report.kept + report.droppedGeometry).toBe(3);
  });
});
