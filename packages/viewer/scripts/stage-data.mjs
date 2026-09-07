// Copies the artifacts the viewer needs into public-data/, which Vite serves
// as its publicDir. Runs as predev/prebuild so `pnpm dev` and `pnpm build`
// always see fresh data without ever pointing Vite at the full 154 MB dist/
// directory (see vite.config.ts).
//
// Prefers the repo's real dist/ (produced by `pnpm build` at the repo root)
// and falls back to fixtures/dist/ so a fresh clone can run without first
// downloading and building the 46 MB source data.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const full = resolve(repoRoot, "dist");
const fixture = resolve(repoRoot, "fixtures/dist");
const outDir = resolve(here, "..", "public-data");

const FILES = ["polities.json", "versions.0.json", "land.0.json", "manifest.json"];

const sourceDir = existsSync(full) ? full : fixture;
console.log(`stage-data: copying artifacts from ${sourceDir}`);

mkdirSync(outDir, { recursive: true });

for (const file of FILES) {
  const src = resolve(sourceDir, file);
  if (!existsSync(src)) {
    console.error(`stage-data: missing required artifact ${src}`);
    process.exit(1);
  }
  copyFileSync(src, resolve(outDir, file));
}

console.log(`stage-data: staged ${FILES.length} files into ${outDir}`);
