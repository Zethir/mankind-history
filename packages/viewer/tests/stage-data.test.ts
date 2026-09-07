import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_FILES,
  listFiles,
  resolveSourceDir,
  stageFiles,
} from "../scripts/stage-data-lib.mjs";

// All fixtures live under a fresh temp directory per test, never inside the
// repo's real dist/ or fixtures/dist/ -- resolveSourceDir and stageFiles take
// their candidate/source paths as arguments, so no filesystem mutation of
// checked-in data is needed to exercise either branch.
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "stage-data-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeArtifacts(dir: string, files: readonly string[]): void {
  for (const file of files) {
    writeFileSync(join(dir, file), `{"file":"${file}"}`, "utf8");
  }
}

// Hard-coded and sorted, deliberately NOT imported or derived from
// ARTIFACT_FILES. If this were built from the export under test, every
// assertion below would reduce to "ARTIFACT_FILES equals ARTIFACT_FILES" --
// it could never fail no matter how ARTIFACT_FILES changed. The duplication
// here is the test: it is what makes a bad ARTIFACT_FILES value (a typo, a
// dropped entry, or a fifth entry such as "versions.1.json" -- the exact
// 154 MB file the dist/ vs fixtures/dist correction exists to keep out of
// the viewer build) show up as a failing assertion instead of passing
// silently.
const EXPECTED_ARTIFACT_FILES = [
  "land.0.json",
  "manifest.json",
  "polities.json",
  "versions.0.json",
];

describe("ARTIFACT_FILES", () => {
  it("is exactly the four artifacts the viewer needs, no more, no fewer", () => {
    expect([...ARTIFACT_FILES].sort()).toEqual(EXPECTED_ARTIFACT_FILES);
  });
});

describe("resolveSourceDir", () => {
  it("picks the first candidate that exists", () => {
    const full = tempDir();
    const fixture = tempDir();
    expect(resolveSourceDir([full, fixture])).toBe(full);
  });

  it("falls back to the next candidate when the first does not exist", () => {
    const fixture = tempDir();
    const missingFull = join(tmpdir(), "stage-data-test-does-not-exist");
    expect(resolveSourceDir([missingFull, fixture])).toBe(fixture);
  });

  it("throws, naming every candidate, when none exist", () => {
    const a = join(tmpdir(), "stage-data-test-missing-a");
    const b = join(tmpdir(), "stage-data-test-missing-b");
    expect(() => resolveSourceDir([a, b])).toThrow(new RegExp(`${a}.*${b}`));
  });
});

describe("stageFiles", () => {
  it("copies exactly the expected files, no more and no fewer", () => {
    const source = tempDir();
    const out = join(tempDir(), "public-data");
    // Fixture and expectation both come from the hard-coded list above, not
    // from ARTIFACT_FILES, so this proves stageFiles copies what it is told
    // to copy -- independently of whatever the real export happens to say.
    writeArtifacts(source, EXPECTED_ARTIFACT_FILES);

    const staged = stageFiles(source, EXPECTED_ARTIFACT_FILES, out);

    expect(staged.sort()).toEqual(EXPECTED_ARTIFACT_FILES);
    expect(listFiles(out)).toEqual(EXPECTED_ARTIFACT_FILES);
  });

  it("does not copy a file that exists in the source but is not in the list", () => {
    const source = tempDir();
    const out = join(tempDir(), "public-data");
    writeArtifacts(source, EXPECTED_ARTIFACT_FILES);
    // An extra file present in the source dir but never requested -- e.g.
    // the exact versions.1.json the correction exists to keep out.
    writeFileSync(join(source, "versions.1.json"), '{"file":"versions.1.json"}', "utf8");

    stageFiles(source, EXPECTED_ARTIFACT_FILES, out);

    expect(listFiles(out)).toEqual(EXPECTED_ARTIFACT_FILES);
  });

  it("creates the output directory if it does not exist yet", () => {
    const source = tempDir();
    const out = join(tempDir(), "nested", "public-data");
    writeArtifacts(source, EXPECTED_ARTIFACT_FILES);

    stageFiles(source, EXPECTED_ARTIFACT_FILES, out);

    expect(listFiles(out)).toEqual(EXPECTED_ARTIFACT_FILES);
  });

  it("fails loudly, naming the missing file, rather than succeeding silently", () => {
    const source = tempDir();
    const out = join(tempDir(), "public-data");
    // Write every expected file except manifest.json.
    writeArtifacts(
      source,
      EXPECTED_ARTIFACT_FILES.filter((f) => f !== "manifest.json"),
    );
    mkdirSync(out, { recursive: true });

    expect(() => stageFiles(source, EXPECTED_ARTIFACT_FILES, out)).toThrow(/manifest\.json/);
  });
});
