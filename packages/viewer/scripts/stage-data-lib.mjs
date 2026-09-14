// Pure logic for stage-data.mjs, split out so it can be exercised directly by
// vitest without shelling out to a child process. Plain JS (not .ts) so the
// CLI entry point (stage-data.mjs) can `node`-run it with no build step.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every artifact the pipeline emits into dist/ (see emit.ts). Exported so the
 * test suite asserts against the same list stage-data.mjs actually copies --
 * a typo or a dropped entry here is exactly the kind of regression that would
 * silently 404 one of the viewer's runtime fetches against public-data/.
 *
 * This used to be a curated subset of four (polities, versions.0, land.0,
 * manifest): vite.config.ts's comment explained that dist/ "also carries
 * versions.1.json and versions.2.json", ~124 MB this milestone never
 * requested, so they were deliberately left unstaged. That stopped being true
 * once the viewer's progressive-upgrade chain started fetching every version
 * level and both land levels live (LevelRegistry in data/levels.ts,
 * fetchVersions/fetchLand in data/artifacts.ts, wired up from main.ts) --
 * changes.json has also been fetched by fetchArtifacts since the change-years
 * work, and was simply missing from this list, breaking `pnpm dev` and the
 * viewer build outright before any of that ever ran. All eight of the
 * pipeline's outputs are staged now; there is no longer a real dist/ artifact
 * this list excludes.
 */
export const ARTIFACT_FILES = [
  "polities.json",
  "versions.0.json",
  "versions.1.json",
  "versions.2.json",
  "land.0.json",
  "land.1.json",
  "changes.json",
  "manifest.json",
];

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
