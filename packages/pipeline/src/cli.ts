import { build, loadAliases, loadOverlaps } from "./build";
import { fetchSource } from "./fetch/download";
import { SOURCES } from "./sources";

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

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else if (command === "build") {
  runBuild();
} else {
  console.error(`Unknown command "${command ?? ""}". Known: fetch, build`);
  process.exit(1);
}
