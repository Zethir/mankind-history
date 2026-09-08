// Pure logic for stage-data.mjs, split out so it can be exercised directly by
// vitest without shelling out to a child process. Plain JS (not .ts) so the
// CLI entry point (stage-data.mjs) can `node`-run it with no build step.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The artifacts the viewer needs. Exported so the test suite asserts against
 * the same list stage-data.mjs actually copies -- a typo or an extra entry
 * here is exactly the kind of regression that would silently stage stale or
 * unwanted data (e.g. reintroducing the 154 MB versions.1.json/versions.2.json
 * the correction in vite.config.ts exists to keep out of the build).
 */
export const ARTIFACT_FILES = ["polities.json", "versions.0.json", "land.0.json", "manifest.json"];

/**
 * Returns the first candidate directory that exists, in order. Candidates are
 * passed in (rather than hard-coded) so callers -- and tests -- control both
 * branches without touching the real dist/ or fixtures/dist/.
 */
export function resolveSourceDir(candidates) {
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  throw new Error(
    `stage-data: none of the candidate source directories exist: ${candidates.join(", ")}`,
  );
}

/**
 * Copies `files` from `sourceDir` into `outDir`, creating `outDir` if needed.
 * Fails loudly -- naming the missing file -- rather than partially staging a
 * directory that looks complete but is missing a required artifact.
 * Returns the list of file names staged, for callers to report or assert on.
 */
export function stageFiles(sourceDir, files, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const src = resolve(sourceDir, file);
    if (!existsSync(src)) {
      throw new Error(`stage-data: missing required artifact ${src}`);
    }
    copyFileSync(src, resolve(outDir, file));
  }
  return [...files];
}

/** Names currently present in a directory, for asserting "exactly these files". */
export function listFiles(dir) {
  return readdirSync(dir).sort();
}
