import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Artifacts are served as static files at the site root. They are staged into
 * public-data/ by scripts/stage-data.mjs (run as predev/prebuild) rather than
 * pointing publicDir at the repo's dist/ directly: dist/ is 154 MB because it
 * also carries versions.1.json and versions.2.json, which this milestone
 * never requests, and Vite copies the whole of publicDir into the build
 * output.
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
