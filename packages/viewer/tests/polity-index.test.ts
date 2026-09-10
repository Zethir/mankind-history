import type { Version, VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { buildPalette } from "../src/render/palette";
import { buildPolityIndex } from "../src/render/polity-index";

// Fixture: 47 rows, 12 polities, 11 with more than one version (one with 12).
const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

function makeMembershipVersion(id: string, polityId: string, memberOf: string | null): Version {
  return {
    id,
    polityId,
    memberOf,
    fromYear: 1900,
    toYear: 1950,
    area: 1000,
    prevId: null,
    delta: null,
    gap: null,
    confidence: null,
    source: { dataset: "cliopatria", version: "test" },
  };
}

/**
 * `fixtures/dist/versions.0.json` was blessed before decision 0017 landed
 * memberOf in the real data (checked: all 47 fixture rows carry
 * `memberOf: null` -- see the report this shipped with), so the fixture alone
 * cannot exercise the non-null lookup. This synthetic artifact has one
 * component version whose memberOf names an aggregate, one aggregate version
 * whose own memberOf is null (the aggregate's own row, per decision 0017's
 * French Third Republic example), and one ordinary version with no membership
 * at all.
 */
function buildMembershipArtifact(): VersionsArtifact {
  return {
    schemaVersion: 2,
    level: "coarse",
    coordScale: 100_000,
    rows: [
      makeMembershipVersion(
        "name:French Africa@1926",
        "name:French Africa",
        "name:(French Third Republic)",
      ),
      makeMembershipVersion(
        "name:(French Third Republic)@1926",
        "name:(French Third Republic)",
        null,
      ),
      makeMembershipVersion("name:Etruscans@1900", "name:Etruscans", null),
    ],
    geometry: {},
  };
}

describe("buildPolityIndex", () => {
  it("resolves every version id in the fixture to its own row's polityId", () => {
    const index = buildPolityIndex(versions);
    expect(index.size).toBe(versions.rows.length);
    for (const row of versions.rows) {
      expect(index.get(row.id)?.polityId).toBe(row.polityId);
    }
  });

  // The assertion that would catch a version-keyed palette: if the index (or
  // the draw loop composing it with colourFor) ever used a version id where a
  // polity id belonged, two versions of the same polity would hash to two
  // different colours, and this is exactly what would fail.
  it("resolves every version of a multi-version polity through the palette to one colour", () => {
    const index = buildPolityIndex(versions);
    const palette = buildPalette(versions);
    const versionsByPolity = new Map<string, string[]>();
    for (const row of versions.rows) {
      const ids = versionsByPolity.get(row.polityId) ?? [];
      ids.push(row.id);
      versionsByPolity.set(row.polityId, ids);
    }
    const multiVersion = [...versionsByPolity.entries()].filter(([, ids]) => ids.length > 1);
    expect(multiVersion.length).toBe(11);
    expect(Math.max(...multiVersion.map(([, ids]) => ids.length))).toBe(12);

    for (const [polityId, versionIds] of multiVersion) {
      const colours = new Set(
        versionIds.map((versionId) => {
          const resolved = index.get(versionId);
          expect(resolved, versionId).toBeDefined();
          return palette.colourFor((resolved as { polityId: string }).polityId);
        }),
      );
      expect(colours.size, polityId).toBe(1);
    }
  });

  it("has no entry for a version id the artifact does not carry", () => {
    const index = buildPolityIndex(versions);
    expect(index.has("no-such-version-id")).toBe(false);
    expect(index.get("no-such-version-id")).toBeUndefined();
  });

  // The fixture carries no memberOf at all (see buildMembershipArtifact's
  // comment), so the non-null case needs a synthetic artifact. A wrong value
  // here -- e.g. the index returning the component's own polityId instead of
  // the aggregate's, or dropping memberOf and reading undefined -- would make
  // "on" mode fall back to the component's own colour instead of the
  // aggregate's, silently undoing the whole feature.
  it("resolves memberOf for a version that belongs to an aggregate", () => {
    const index = buildPolityIndex(buildMembershipArtifact());
    const entry = index.get("name:French Africa@1926");
    expect(entry).toBeDefined();
    expect(entry?.polityId).toBe("name:French Africa");
    expect(entry?.memberOf).toBe("name:(French Third Republic)");
  });

  // The null case: an aggregate's own row, and an ordinary unaffiliated
  // polity, must both resolve memberOf to null rather than to some other
  // string (their own id, an empty string, or the sibling aggregate's id
  // would each be a wrong value that this catches).
  it("resolves memberOf to null for a version with no membership", () => {
    const index = buildPolityIndex(buildMembershipArtifact());
    const aggregate = index.get("name:(French Third Republic)@1926");
    const ordinary = index.get("name:Etruscans@1900");
    expect(aggregate?.memberOf).toBeNull();
    expect(ordinary?.memberOf).toBeNull();
  });
});
