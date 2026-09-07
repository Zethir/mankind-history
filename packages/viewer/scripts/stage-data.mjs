// CLI entry point: copies the artifacts the viewer needs into public-data/,
// which Vite serves as its publicDir. Runs as predev/prebuild so `pnpm dev`
// and `pnpm build` always see fresh data without ever pointing Vite at the
// full 154 MB dist/ directory (see vite.config.ts).
//
// Prefers the repo's real dist/ (produced by `pnpm build` at the repo root)
// and falls back to fixtures/dist/ so a fresh clone can run without first
// downloading and building the 46 MB source data.
//
// The actual decisions (which source directory, which files, fail-loudly on
// a missing one) live in stage-data-lib.mjs, which is unit tested directly by
// vitest -- this file is just wiring for the real paths and process exit.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTIFACT_FILES, resolveSourceDir, stageFiles } from "./stage-data-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const full = resolve(repoRoot, "dist");
const fixture = resolve(repoRoot, "fixtures/dist");
const outDir = resolve(here, "..", "public-data");

try {
  const sourceDir = resolveSourceDir([full, fixture]);
  console.log(`stage-data: copying artifacts from ${sourceDir}`);
  const staged = stageFiles(sourceDir, ARTIFACT_FILES, outDir);
  console.log(`stage-data: staged ${staged.length} files into ${outDir}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
