import { describe, expect, it } from "vitest";
import { deriveLineage } from "../src/stages/lineage";
import type { NormalisedRow } from "../src/stages/normalise";

function row(fromYear: number, toYear: number, area: number): NormalisedRow {
  return {
    name: "P",
    wikidata: null,
    wikipedia: null,
    seshat: null,
    fromYear,
    toYear,
    area,
    polygons: [],
  };
}

const P = "wd:Q1";
const Q = "wd:Q2";

describe("deriveLineage", () => {
  it("leaves prevId, delta and gap null on a first appearance", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "1.0.0");
    expect(versions[0]).toMatchObject({ prevId: null, delta: null, gap: null });
  });

  it("sets all three on every later version", () => {
    const rows = [row(0, 50, 10), row(80, 120, 25)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions[1]).toMatchObject({ prevId: "wd:Q1@0", delta: 15, gap: 30 });
  });

  it("computes delta as area minus prev.area, including for contraction", () => {
    const rows = [row(0, 50, 40), row(60, 90, 25)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions[1]?.delta).toBe(-15);
  });

  it("floors gap at zero for versions that abut exactly", () => {
    const rows = [row(0, 50, 10), row(50, 90, 10)];
    const { versions } = deriveLineage(
      rows,
      [P, P],
      [{ earlier: "wd:Q1@0", later: "wd:Q1@50", reason: "abuts" }],
      "1.0.0",
    );
    expect(versions[1]?.gap).toBe(0);
  });

  it("orders by fromYear regardless of input order", () => {
    const rows = [row(80, 120, 25), row(0, 50, 10)];
    const { versions } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(versions.map((v) => v.fromYear)).toEqual([0, 80]);
    expect(versions[1]?.prevId).toBe("wd:Q1@0");
  });

  it("keeps lineage chains separate per polity", () => {
    const rows = [row(0, 50, 10), row(0, 50, 99)];
    const { versions } = deriveLineage(rows, [P, Q], [], "1.0.0");
    expect(versions.every((v) => v.prevId === null)).toBe(true);
  });

  it("fails the build when one polity has two versions with the same from_year", () => {
    const rows = [row(0, 50, 10), row(0, 90, 20)];
    expect(() => deriveLineage(rows, [P, P], [], "1.0.0")).toThrow(/duplicate from_year/i);
  });

  it("fails the build on an overlap that is not whitelisted", () => {
    const rows = [row(0, 100, 10), row(50, 150, 20)];
    expect(() => deriveLineage(rows, [P, P], [], "1.0.0")).toThrow(/not whitelisted/i);
  });

  it("permits an overlap that is whitelisted with a reason, and still reports it", () => {
    const rows = [row(0, 100, 10), row(50, 150, 20)];
    const whitelist = [{ earlier: "wd:Q1@0", later: "wd:Q1@50", reason: "co-regency in source" }];
    const { versions, overlaps } = deriveLineage(rows, [P, P], whitelist, "1.0.0");
    expect(versions).toHaveLength(2);
    expect(overlaps).toEqual([{ earlier: "wd:Q1@0", later: "wd:Q1@50" }]);
  });

  it("leaves confidence unpopulated (decision 0005)", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "1.0.0");
    expect(versions[0]?.confidence).toBeNull();
  });

  it("records which upstream release each version came from", () => {
    const { versions } = deriveLineage([row(0, 50, 10)], [P], [], "2.1.0");
    expect(versions[0]?.source).toEqual({ dataset: "cliopatria", version: "2.1.0" });
  });

  it("maps every version id back to its source row, so geometry can follow", () => {
    const rows = [row(80, 120, 25), row(0, 50, 10)];
    const { rowIndexById } = deriveLineage(rows, [P, P], [], "1.0.0");
    expect(rowIndexById["wd:Q1@80"]).toBe(0);
    expect(rowIndexById["wd:Q1@0"]).toBe(1);
  });

  it("sorts output by polity then year, so the artifact is deterministic", () => {
    const rows = [row(0, 10, 1), row(0, 10, 1), row(20, 30, 1)];
    const { versions } = deriveLineage(rows, [Q, P, P], [], "1.0.0");
    expect(versions.map((v) => v.id)).toEqual(["wd:Q1@0", "wd:Q1@20", "wd:Q2@0"]);
  });
});
