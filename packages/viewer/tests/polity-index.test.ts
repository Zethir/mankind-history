import type { VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { buildPalette } from "../src/render/palette";
import { buildPolityIndex } from "../src/render/polity-index";

// Fixture: 47 rows, 12 polities, 11 with more than one version (one with 12).
const versions = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json");

describe("buildPolityIndex", () => {
  it("resolves every version id in the fixture to its own row's polityId", () => {
    const index = buildPolityIndex(versions);
    expect(index.size).toBe(versions.rows.length);
    for (const row of versions.rows) {
      expect(index.get(row.id)).toBe(row.polityId);
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
          return palette.colourFor(resolved as string);
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
});
