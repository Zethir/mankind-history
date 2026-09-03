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

const command = process.argv[2];
if (command === "fetch") {
  await runFetch();
} else {
  console.error(`Unknown command "${command ?? ""}". Known: fetch`);
  process.exit(1);
}
