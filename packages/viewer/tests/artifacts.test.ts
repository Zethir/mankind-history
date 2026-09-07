import type { LandArtifact, PolitiesArtifact, VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { validateArtifacts } from "../src/data/artifacts";

const FIXTURES = "fixtures/dist";

function load() {
  return {
    polities: readArtifact<PolitiesArtifact>(`${FIXTURES}/polities.json`),
    versions: readArtifact<VersionsArtifact>(`${FIXTURES}/versions.0.json`),
    land: readArtifact<LandArtifact>(`${FIXTURES}/land.0.json`),
  };
}

describe("validateArtifacts", () => {
  it("accepts the committed fixture artifacts", () => {
    expect(() => validateArtifacts(load())).not.toThrow();
  });

  // Acceptance criterion 18: the viewer refuses to start on an unrecognised
  // schemaVersion rather than half-rendering a map built from assumptions
  // that no longer hold.
  it("refuses an unrecognised schemaVersion, naming the file", () => {
    const a = load();
    a.versions.schemaVersion = 999;
    expect(() => validateArtifacts(a)).toThrow(/versions\.0\.json.*999/);
  });

  it("checks every artifact, not just the first", () => {
    const a = load();
    a.land.schemaVersion = 999;
    expect(() => validateArtifacts(a)).toThrow(/land\.0\.json/);
  });
});
