import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";
import type { SourceSpec } from "../sources";

export function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type Fetcher = (url: string) => Promise<Buffer>;

export const httpFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
};

export interface FetchResult {
  dataset: string;
  path: string;
  sha256: string;
  bytes: number;
  cached: boolean;
}

export interface FetchOptions {
  /** Permit an unpinned source, so its checksum can be recorded. */
  writePins: boolean;
  refresh: boolean;
  fetcher?: Fetcher;
}

/**
 * Download one source, verify it, and unpack it if it is a zip.
 *
 * Nothing is written before the checksum matches. A pipeline that proceeds on
 * unverified input cannot make the determinism guarantee, so a mismatch is an
 * error and never a warning.
 */
export async function fetchSource(
  spec: SourceSpec,
  outDir: string,
  opts: FetchOptions,
): Promise<FetchResult> {
  mkdirSync(outDir, { recursive: true });
  const rawPath = join(outDir, spec.file);

  if (spec.sha256 === null && !opts.writePins) {
    throw new Error(
      `Source "${spec.dataset}" is unpinned. Run with --write-pins to record its checksum, ` +
        "then commit the values into packages/pipeline/src/sources.ts.",
    );
  }

  if (!opts.refresh && existsSync(rawPath)) {
    const existing = readFileSync(rawPath);
    const digest = sha256Of(existing);
    if (spec.sha256 === null || digest === spec.sha256) {
      unpackIfNeeded(spec, existing, outDir);
      return {
        dataset: spec.dataset,
        path: rawPath,
        sha256: digest,
        bytes: existing.length,
        cached: true,
      };
    }
    throw new Error(
      `Cached ${spec.dataset} checksum mismatch: expected ${spec.sha256}, found ${digest}. ` +
        "Delete the file and re-fetch, or correct the pin.",
    );
  }

  const fetcher = opts.fetcher ?? httpFetcher;
  const body = await fetcher(spec.url);
  const digest = sha256Of(body);
  if (spec.sha256 !== null && digest !== spec.sha256) {
    throw new Error(
      `Downloaded ${spec.dataset} checksum mismatch: expected ${spec.sha256}, got ${digest}. ` +
        "Upstream changed under a pinned version, which is a provenance failure. Nothing written.",
    );
  }

  writeFileSync(rawPath, body);
  unpackIfNeeded(spec, body, outDir);
  return {
    dataset: spec.dataset,
    path: rawPath,
    sha256: digest,
    bytes: body.length,
    cached: false,
  };
}

function unpackIfNeeded(spec: SourceSpec, raw: Buffer, outDir: string): void {
  if (!spec.unpack) return;
  // Always re-extract rather than skipping when the target exists. The archive
  // is checksum-verified, so anything taken from it is correct by construction.
  // Skipping would let a corrupted or stale unpacked file survive and be handed
  // to the pipeline by sourcePath(), which never re-verifies it.
  const entry = new AdmZip(raw).getEntry(spec.unpack);
  if (!entry) throw new Error(`Zip for ${spec.dataset} has no entry "${spec.unpack}"`);
  writeFileSync(join(outDir, spec.unpack), entry.getData());
}
