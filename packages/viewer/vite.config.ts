import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Artifacts are served as static files at the site root. They are staged into
 * public-data/ by scripts/stage-data.mjs (run as predev/prebuild) rather than
 * pointing publicDir at the repo's dist/ directly, so this build never
 * accidentally serves something dist/ carries that stage-data.mjs's
 * ARTIFACT_FILES list does not name.
 *
 * Every one of dist/'s eight artifacts is staged and shipped now: the
 * progressive-upgrade chain (LevelRegistry in data/levels.ts) fetches all
 * three version levels and both land levels at runtime, not just the coarse
 * pair. See ARTIFACT_FILES's comment in scripts/stage-data-lib.mjs for the
 * history (this used to be a curated four-file subset) and
 * .github/workflows/deploy.yml for the resulting size accounting.
 */
export default defineConfig({
  // The site is served from https://<user>.github.io/mankind-history/, a
  // subpath, not the origin root. fetchArtifacts already defaults to a
  // relative base ("."), which resolves correctly under a subpath; this is
  // what makes Vite emit the same subpath into index.html's asset links.
  base: "/mankind-history/",
  publicDir: resolve(import.meta.dirname, "public-data"),
  build: { outDir: "dist-app", emptyOutDir: true },
});
