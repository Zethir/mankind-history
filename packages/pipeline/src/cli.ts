import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChangesArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { build, loadAliases, loadOverlaps } from "./build";
import { fetchSource } from "./fetch/download";
import { REGIONS, resolveEra, resolveRegion } from "./regions";
import { SOURCES } from "./sources";
import { selectFeatures } from "./stages/extract-fixture";
import { analyse, type HistogramResult } from "./stages/histogram";

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

async function runBuild(): Promise<void> {
  const sourcesDir = option("sources", "data/sources");
  const outDir = option("out", "dist");
  const report = await build({
    sourcesDir,
    outDir,
    aliases: loadAliases("packages/pipeline/aliases.json"),
    overlaps: loadOverlaps("packages/pipeline/overlaps.json"),
  });

  const n = report.normalise;
  const nc = report.normaliseLand.coarse;
  const nm = report.normaliseLand.mid;
  const c = report.identityConflicts;
  console.log(`\n  ${report.polities} polities, ${report.versions} versions -> ${outDir}`);
  console.log(
    `  Dropped: ${n.droppedNonPolity} non-POLITY, ${n.droppedYears} bad years, ` +
      `${n.droppedGeometry} bad geometry, ${n.droppedParts} bad geometry parts. ` +
      `Closed ${n.closedRings} open rings.`,
  );
  console.log(
    `  Land dropped: coarse ${nc.droppedGeometry} bad geometry / ${nc.droppedParts} bad parts, ` +
      `mid ${nm.droppedGeometry} bad geometry / ${nm.droppedParts} bad parts.`,
  );
  console.log(
    `  Identity conflicts (first non-null kept, later value discarded): ` +
      `${c.wikidata} wikidata, ${c.wikipedia} wikipedia, ${c.seshat} seshat.`,
  );
  console.log(`  Antimeridian: ${report.polygonsCut} version polygons cut.`);
  console.log(
    `  Antimeridian (land): ${report.landPolygonsCut.coarse} coarse, ` +
      `${report.landPolygonsCut.mid} mid polygons cut.`,
  );
  console.log(`  Overlaps (whitelisted): ${report.overlaps}.`);
  console.log(`  Land: ${report.landPolygons.coarse} coarse, ${report.landPolygons.mid} mid.`);
  console.log(
    `  Levels: coarse ${report.levels.coarse.vertices.toLocaleString()} vertices ` +
      `at ${report.levels.coarse.percent}%, mid ${report.levels.mid.vertices.toLocaleString()} ` +
      `at ${report.levels.mid.percent}%.\n`,
  );
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

function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`;
}

function parseBbox(spec: string): [number, number, number, number] {
  const parts = spec.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--bbox must be minLon,minLat,maxLon,maxLat, got "${spec}"`);
  }
  return [parts[0] as number, parts[1] as number, parts[2] as number, parts[3] as number];
}

function printChart(result: HistogramResult, label: string, bucket: number): void {
  const { buckets } = result;
  if (buckets.length === 0) {
    console.log(`\n  ${label}: no matching change years.\n`);
    return;
  }
  const max = Math.max(...buckets.map((b) => b.changeYears));
  const width = 44;
  const labelWidth = Math.max(...buckets.map((b) => formatYear(b.start).length));

  console.log(`\n  ${label} -- distinct change years per ${bucket}-year bucket\n`);
  for (const b of buckets) {
    const filled = max === 0 ? 0 : Math.round((b.changeYears / max) * width);
    const bar = "#".repeat(filled).padEnd(width, ".");
    const start = formatYear(b.start).padStart(labelWidth);
    console.log(`  ${start}  ${bar}  ${String(b.changeYears).padStart(4)} changes`);
  }
  console.log("");
}

function printAcceleration(result: HistogramResult, speed: number, deadtime: number): void {
  const profile = result.acceleration;
  if (!profile) {
    console.log("  Not enough change years to profile acceleration.\n");
    return;
  }
  const pct = (profile.fraction * 100).toFixed(0);
  console.log(
    `  At ${speed} yr/s with a ${deadtime}s dead-time ceiling: ` +
      `${pct}% of the timeline accelerated, ` +
      `${profile.acceleratedGaps}/${profile.totalGaps} gaps compressed.`,
  );
  console.log(
    `  Longest silence: ${profile.longestGap} years ` +
      `(${profile.longestGapSeconds.toFixed(0)}s unaccelerated).`,
  );
  if (profile.fraction > 0.6) {
    console.log(
      "  Over 60%. At this speed the experience is mostly fast-forward. " +
        "Either raise the base speed here or accept that this region is a " +
        "place you jump to rather than play through.",
    );
  }
  console.log("");
}

function runHistogram(): void {
  const distDir = option("dist", "dist");
  const bucket = Number(option("bucket", "100"));
  const speed = Number(option("speed", "4"));
  const deadtime = Number(option("deadtime", "7"));
  const era = resolveEra(option("era", "all"));
  const from = process.argv.some((a) => a.startsWith("--from="))
    ? Number(option("from", "0"))
    : era.from;
  const to = process.argv.some((a) => a.startsWith("--to=")) ? Number(option("to", "0")) : era.to;

  const changes = readArtifact<ChangesArtifact>(join(distDir, "changes.json"));

  const bboxSpec = option("bbox", "");
  const regionSpec = option("region", "");
  const targets: Array<{ key: string; label: string; bbox: [number, number, number, number] }> =
    bboxSpec
      ? [{ key: "custom", label: "Custom region", bbox: parseBbox(bboxSpec) }]
      : regionSpec
        ? [
            {
              key: regionSpec,
              label: resolveRegion(regionSpec).label,
              bbox: resolveRegion(regionSpec).bbox,
            },
          ]
        : Object.entries(REGIONS).map(([key, region]) => ({
            key,
            label: region.label,
            bbox: region.bbox,
          }));

  const output: Record<string, HistogramResult> = {};
  for (const target of targets) {
    const result = analyse(changes, target.bbox, from, to, bucket, speed, deadtime);
    const label = `${target.label}, ${formatYear(from)} to ${formatYear(to)}`;
    printChart(result, label, bucket);
    printAcceleration(result, speed, deadtime);
    output[target.key] = result;
  }

  const outSpec = option("out", "");
  if (outSpec) {
    mkdirSync(dirname(outSpec), { recursive: true });
    writeFileSync(outSpec, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`  Written to ${outSpec}\n`);
  }
}

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else if (command === "build") {
  await runBuild();
} else if (command === "extract-fixture") {
  runExtractFixture();
} else if (command === "histogram") {
  runHistogram();
} else {
  console.error(
    `Unknown command "${command ?? ""}". Known: fetch, build, extract-fixture, histogram`,
  );
  process.exit(1);
}
