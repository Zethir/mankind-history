import { describe, expect, it } from "vitest";
import { type AliasEntry, assignIdentity, resolvePolityId } from "../src/stages/identity";
import type { NormalisedRow } from "../src/stages/normalise";

function row(overrides: Partial<NormalisedRow> = {}): NormalisedRow {
  return {
    name: "Roman Empire",
    wikidata: null,
    wikipedia: null,
    seshat: null,
    fromYear: 0,
    toYear: 100,
    area: 1,
    polygons: [],
    ...overrides,
  };
}

describe("resolvePolityId", () => {
  it("keys on the upstream Name, storing Wikidata as metadata rather than using it as the key", () => {
    expect(resolvePolityId(row({ wikidata: "Q1747689" }), [])).toBe("name:Roman Empire");
  });

  it("keys on Name for rows with no Wikidata id too", () => {
    expect(resolvePolityId(row({ name: "Kingdom of Numidia" }), [])).toBe(
      "name:Kingdom of Numidia",
    );
  });

  it("lets an alias on name override the fallback", () => {
    const aliases: AliasEntry[] = [
      {
        match: { name: "Roman Empire (Western)" },
        canonical: "wd:Q1747689",
        reason: "split label",
      },
    ];
    expect(resolvePolityId(row({ name: "Roman Empire (Western)" }), aliases)).toBe("wd:Q1747689");
  });

  it("lets an alias on wikidata override a merged or redirected item", () => {
    const aliases: AliasEntry[] = [
      { match: { wikidata: "Q999" }, canonical: "wd:Q1747689", reason: "merged upstream" },
    ];
    expect(resolvePolityId(row({ wikidata: "Q999" }), aliases)).toBe("wd:Q1747689");
  });
});

describe("assignIdentity", () => {
  it("collapses many rows of one polity into a single Polity", () => {
    const rows = [
      row({ wikidata: "Q1747689", fromYear: -27 }),
      row({ wikidata: "Q1747689", fromYear: 117 }),
    ];
    const { polities, rowPolityIds } = assignIdentity(rows, []);
    expect(polities).toHaveLength(1);
    expect(rowPolityIds).toEqual(["name:Roman Empire", "name:Roman Empire"]);
  });

  it("takes the first non-null reference identifier across a polity's rows", () => {
    const rows = [
      row({ wikidata: "Q1", wikipedia: null, seshat: null }),
      row({ wikidata: "Q1", wikipedia: "Roman_Empire", seshat: "12" }),
    ];
    const { polities } = assignIdentity(rows, []);
    expect(polities[0]).toMatchObject({
      id: "name:Roman Empire",
      wikidata: "Q1",
      wikipedia: "Roman_Empire",
      seshat: "12",
    });
  });

  it("stores the normalised name so the deferred drift report has data to diff", () => {
    const { polities } = assignIdentity([row({ name: "C\u00f4te d'Ivoire" })], []);
    expect(polities[0]?.normalizedName).toBe("cote-d-ivoire");
  });

  it("returns polities sorted by id, so output ordering is deterministic", () => {
    const rows = [row({ name: "Zeta" }), row({ name: "Alpha" }), row({ wikidata: "Q5" })];
    const { polities } = assignIdentity(rows, []);
    expect(polities.map((p) => p.id)).toEqual(["name:Alpha", "name:Roman Empire", "name:Zeta"]);
  });

  it("keeps entities distinct that share a Wikidata id, since Cliopatria reuses ids", () => {
    const rows = [
      row({ wikidata: "Q7462", name: "Northern Song" }),
      row({ wikidata: "Q7462", name: "Southern Song" }),
    ];
    const { polities, rowPolityIds } = assignIdentity(rows, []);
    expect(polities).toHaveLength(2);
    expect(rowPolityIds).toEqual(["name:Northern Song", "name:Southern Song"]);
    expect(polities.every((p) => p.wikidata === "Q7462")).toBe(true);
  });

  it("keeps a parenthesised label distinct from its bare form, as the source does", () => {
    const rows = [
      row({ wikidata: "Q83958", name: "Macedonian Empire" }),
      row({ wikidata: "Q83958", name: "(Macedonian Empire)" }),
    ];
    const { polities } = assignIdentity(rows, []);
    expect(polities.map((p) => p.id)).toEqual([
      "name:(Macedonian Empire)",
      "name:Macedonian Empire",
    ]);
  });
});
