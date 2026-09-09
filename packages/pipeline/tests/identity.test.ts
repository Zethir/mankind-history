import { describe, expect, it } from "vitest";
import {
  type AliasEntry,
  assignIdentity,
  resolveMembership,
  resolvePolityId,
} from "../src/stages/identity";
import type { NormalisedRow } from "../src/stages/normalise";

function row(overrides: Partial<NormalisedRow> = {}): NormalisedRow {
  return {
    name: "Roman Empire",
    wikidata: null,
    wikipedia: null,
    seshat: null,
    memberOf: null,
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
    const { polities, conflicts } = assignIdentity(rows, []);
    expect(polities[0]).toMatchObject({
      id: "name:Roman Empire",
      wikidata: "Q1",
      wikipedia: "Roman_Empire",
      seshat: "12",
    });
    expect(conflicts).toEqual({ wikidata: 0, wikipedia: 0, seshat: 0 });
  });

  it("counts, rather than silently drops, a row whose seshat id disagrees with the one already assigned", () => {
    const rows = [
      row({ seshat: "pk_kachi_pre_urban" }),
      row({ seshat: "some_other_id" }),
      row({ seshat: "a_third_id" }),
    ];
    const { polities, conflicts } = assignIdentity(rows, []);
    // First non-null still wins: the polity keeps the first row's id.
    expect(polities[0]?.seshat).toBe("pk_kachi_pre_urban");
    // Both later, disagreeing rows are counted rather than vanishing.
    expect(conflicts).toEqual({ wikidata: 0, wikipedia: 0, seshat: 2 });
  });

  it("does not count a repeat of the same value as a conflict", () => {
    const rows = [row({ wikidata: "Q1" }), row({ wikidata: "Q1" })];
    const { conflicts } = assignIdentity(rows, []);
    expect(conflicts.wikidata).toBe(0);
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

describe("resolveMembership", () => {
  it("resolves a MemberOf name to the same id polityIdFor would build for it", () => {
    // Real values: French Africa is a member of (French Third Republic),
    // which is itself a real polity in the same build.
    const rows = [
      row({ name: "French Africa", memberOf: "(French Third Republic)" }),
      row({ name: "(French Third Republic)", memberOf: null }),
    ];
    const polityIds = new Set(["name:French Africa", "name:(French Third Republic)"]);
    const { rowMemberOfIds, withMemberOf, distinctAggregates } = resolveMembership(
      rows,
      [],
      polityIds,
    );
    expect(rowMemberOfIds).toEqual(["name:(French Third Republic)", null]);
    expect(withMemberOf).toBe(1);
    expect(distinctAggregates).toBe(1);
  });

  it("leaves a row with no MemberOf as null, uncounted", () => {
    const rows = [row({ memberOf: null })];
    const { rowMemberOfIds, withMemberOf } = resolveMembership(rows, [], new Set());
    expect(rowMemberOfIds).toEqual([null]);
    expect(withMemberOf).toBe(0);
  });

  it("applies aliases.json to a MemberOf name exactly as identity resolution applies it", () => {
    // A hypothetical upstream rename of the aggregate: rows still say
    // "Old Aggregate Name", but the alias sends its own polity id elsewhere.
    const aliases: AliasEntry[] = [
      { match: { name: "Old Aggregate Name" }, canonical: "name:New Aggregate Name", reason: "t" },
    ];
    const rows = [row({ name: "Child", memberOf: "Old Aggregate Name" })];
    const polityIds = new Set(["name:Child", "name:New Aggregate Name"]);
    const { rowMemberOfIds } = resolveMembership(rows, aliases, polityIds);
    expect(rowMemberOfIds).toEqual(["name:New Aggregate Name"]);
  });

  it("fails the build on a MemberOf name that resolves to no polity in this build", () => {
    const rows = [row({ name: "Child", memberOf: "Nonexistent Aggregate" })];
    const polityIds = new Set(["name:Child"]);
    expect(() => resolveMembership(rows, [], polityIds)).toThrow(/resolves to no polity/i);
  });

  it("counts every distinct dangling name once, and every affected row overall", () => {
    const rows = [
      row({ name: "A", memberOf: "Ghost" }),
      row({ name: "B", memberOf: "Ghost" }),
      row({ name: "C", memberOf: "Phantom" }),
    ];
    const polityIds = new Set(["name:A", "name:B", "name:C"]);
    try {
      resolveMembership(rows, [], polityIds);
      throw new Error("expected resolveMembership to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/^3 version\(s\)/);
      expect(message).toMatch(/2 distinct/);
      expect(message).toMatch(/Ghost/);
      expect(message).toMatch(/Phantom/);
    }
  });
});
