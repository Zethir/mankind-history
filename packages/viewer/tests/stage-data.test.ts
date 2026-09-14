import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "@history/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_FILES,
  listFiles,
  resolveSourceDir,
  stageFiles,
} from "../scripts/stage-data-lib.mjs";
import { fetchArtifacts, fetchLand, fetchVersions } from "../src/data/artifacts";
import type { DetailLevel } from "../src/render/level";

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
// dropped entry, or an extra one) show up as a failing assertion instead of
// passing silently.
//
// All eight of the pipeline's real dist/ outputs, since Task 9's fix round 1.
// The viewer's progressive-upgrade chain now fetches every version level and
// both land levels at runtime (see stage-data-lib.mjs's ARTIFACT_FILES
// comment), and changes.json was already being fetched by fetchArtifacts, so
// there is no longer a real pipeline artifact this list excludes -- unlike
// the old four-file list, which deliberately left versions.1.json and
// versions.2.json unstaged.
const EXPECTED_ARTIFACT_FILES = [
  "changes.json",
  "land.0.json",
  "land.1.json",
  "manifest.json",
  "polities.json",
  "versions.0.json",
  "versions.1.json",
  "versions.2.json",
];

describe("ARTIFACT_FILES", () => {
  it("is exactly the eight artifacts dist/ produces, no more, no fewer", () => {
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
    // A file sitting in the source directory that was never one of the
    // pipeline's outputs and is not in ARTIFACT_FILES. Unlike the old
    // versions.1.json example, every real dist/ artifact is staged now, so
    // there is no genuine pipeline output left to exclude -- this uses an
    // arbitrary non-artifact file instead, to prove stageFiles copies
    // exactly its `files` argument rather than everything it finds in
    // sourceDir.
    writeFileSync(join(source, "checksums.txt"), "not a pipeline artifact", "utf8");

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

/**
 * The gap above: EXPECTED_ARTIFACT_FILES is hand-copied deliberately (see the
 * comment on it), which catches a typo or a dropped entry in ARTIFACT_FILES
 * but cannot catch the bug this branch actually shipped -- a *new fetch* with
 * no corresponding staged file (`changes.json`, unstaged for an entire task
 * while `fetchArtifacts` already fetched it unconditionally; the deployed
 * site would have 404'd at startup).
 *
 * This suite ties ARTIFACT_FILES to the real fetch call sites instead of to
 * a second hand-copied list, so it cannot become the same kind of tautology
 * EXPECTED_ARTIFACT_FILES's comment warns against: the "expected" side below
 * is not a literal array anyone typed out -- it is the set of filenames
 * produced by actually *calling* `fetchArtifacts`, `fetchVersions` (every
 * `DetailLevel`) and `fetchLand` (every level the pipeline emits land for)
 * against a stubbed `fetch` and recording what URL each call requested. A
 * fetch site added to artifacts.ts with no matching entry in ARTIFACT_FILES
 * makes this test request a name ARTIFACT_FILES does not contain and fails
 * it -- mechanically, the way the design brief asks for, not by convention.
 *
 * The direction is asymmetric on purpose: `manifest.json` is staged and
 * never fetched by any of these three functions, and that is correct (the
 * manifest is for humans and CI, not the running viewer) -- this test only
 * ever asserts requested-implies-staged, never the reverse.
 */
describe("every artifact the viewer actually fetches is staged", () => {
  function stubFetch(): string[] {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        requestedUrls.push(String(input));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ schemaVersion: SCHEMA_VERSION }),
        } as Response;
      }),
    );
    return requestedUrls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests only files that ARTIFACT_FILES stages", async () => {
    const requestedUrls = stubFetch();

    await fetchArtifacts();
    const levels: readonly DetailLevel[] = ["coarse", "mid", "full"];
    for (const level of levels) await fetchVersions(level);
    for (const level of ["coarse", "mid"] as const) await fetchLand(level);

    const requestedFiles = requestedUrls.map((url) => url.split("/").pop() as string);

    // Sanity check on the test's own method, not the thing under test: if
    // this were empty because the stub silently swallowed every call
    // (wrong URL shape, wrong global name), every assertion below would
    // vacuously pass. See mankind-history's own "measure before claiming"
    // lesson -- a check that cannot fail is not a check.
    expect(requestedFiles.length).toBeGreaterThan(0);

    for (const file of requestedFiles) {
      expect(ARTIFACT_FILES).toContain(file);
    }
  });
});
