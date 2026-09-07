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

function writeArtifacts(dir: string, files: readonly string[] = ARTIFACT_FILES): void {
  for (const file of files) {
    writeFileSync(join(dir, file), `{"file":"${file}"}`, "utf8");
  }
}

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
    writeArtifacts(source);

    const staged = stageFiles(source, ARTIFACT_FILES, out);

    expect(staged.sort()).toEqual([...ARTIFACT_FILES].sort());
    // This is the assertion that catches the regression the correction
    // exists to prevent: a typo or an extra entry in the files list would
    // either fail to copy a needed file or stage something unwanted.
    expect(listFiles(out)).toEqual([...ARTIFACT_FILES].sort());
  });

  it("creates the output directory if it does not exist yet", () => {
    const source = tempDir();
    const out = join(tempDir(), "nested", "public-data");
    writeArtifacts(source);

    stageFiles(source, ARTIFACT_FILES, out);

    expect(listFiles(out)).toEqual([...ARTIFACT_FILES].sort());
  });

  it("fails loudly, naming the missing file, rather than succeeding silently", () => {
    const source = tempDir();
    const out = join(tempDir(), "public-data");
    // Write every file except manifest.json.
    writeArtifacts(
      source,
      ARTIFACT_FILES.filter((f) => f !== "manifest.json"),
    );
    mkdirSync(out, { recursive: true });

    expect(() => stageFiles(source, ARTIFACT_FILES, out)).toThrow(/manifest\.json/);
  });
});
