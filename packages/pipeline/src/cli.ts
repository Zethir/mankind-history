import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, loadAliases, loadOverlaps } from "./build";
import { fetchSource } from "./fetch/download";
import { SOURCES } from "./sources";
import { selectFeatures } from "./stages/extract-fixture";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function runFetch(): Promise<void> {
  const outDir = option("sources", "data/sources");
  const writePins = flag("write-pins");
  const refresh = flag("refresh");
  const pins: string[] = [];

  for (const spec of Object.values(SOURCES)) {
    const result = await fetchSource(spec, outDir, { writePins, refresh });
    const state = result.cached ? "cached" : "downloaded";
    console.log(`  ${spec.dataset}: ${state}, ${result.bytes} bytes, sha256 ${result.sha256}`);
    pins.push(`    sha256: "${result.sha256}",   // ${spec.dataset}`);
  }

  if (writePins) {
    console.log("\n  Paste these into packages/pipeline/src/sources.ts:\n");
    console.log(pins.join("\n"));
  }
}

function runBuild(): void {
  const sourcesDir = option("sources", "data/sources");
  const outDir = option("out", "dist");
  const report = build({
    sourcesDir,
    outDir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });

  const n = report.normalise;
  console.log(`\n  ${report.polities} polities, ${report.versions} versions -> ${outDir}`);
  console.log(
    `  Dropped: ${n.droppedNonPolity} non-POLITY, ${n.droppedYears} bad years, ` +
      `${n.droppedGeometry} bad geometry. Closed ${n.closedRings} open rings.`,
  );
  console.log(`  Antimeridian: ${report.polygonsCut} polygons cut.`);
  console.log(`  Overlaps (whitelisted): ${report.overlaps}.`);
  console.log(`  Land: ${report.landPolygons.coarse} coarse, ${report.landPolygons.mid} mid.\n`);
}

function runExtractFixture(): void {
  const sourcesDir = option("sources", "data/sources");
  const outDir = option("out", "fixtures");
  mkdirSync(outDir, { recursive: true });

  // ne_110m_land.geojson is carried through whole, unfiltered: the coarse
  // layer is small and global (it is what a global view needs), so there is
  // no size reason to carve it, and carving it would leave a golden artifact
  // that a broken land pipeline could never make fail. ne_50m_land.geojson
  // is detailed and regional by nature, so it is still carved to the box
  // like cliopatria_polities_only.geojson.
  const filtered = new Set(["cliopatria_polities_only.geojson", "ne_50m_land.geojson"]);

  for (const file of [
    "cliopatria_polities_only.geojson",
    "ne_110m_land.geojson",
    "ne_50m_land.geojson",
  ]) {
    const parsed = JSON.parse(readFileSync(join(sourcesDir, file), "utf8")) as {
      features: unknown[];
    };
    const features = filtered.has(file) ? selectFeatures(parsed.features) : parsed.features;
    // Not the artifact writer: this is source-shaped GeoJSON, not an artifact.
    writeFileSync(
      join(outDir, file),
      `${JSON.stringify({ type: "FeatureCollection", features })}\n`,
    );
    const note = filtered.has(file) ? "" : " (copied whole, unfiltered)";
    console.log(`  ${file}: ${features.length} of ${parsed.features.length} features${note}`);
  }
}

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else if (command === "build") {
  runBuild();
} else if (command === "extract-fixture") {
  runExtractFixture();
} else {
  console.error(`Unknown command "${command ?? ""}". Known: fetch, build, extract-fixture`);
  process.exit(1);
}
