import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fetcher, fetchSource, sha256Of } from "../src/fetch/download";
import type { SourceSpec } from "../src/sources";

const BODY = Buffer.from('{"type":"FeatureCollection","features":[]}');
const BODY_SHA = sha256Of(BODY);

function specOf(overrides: Partial<SourceSpec> = {}): SourceSpec {
  return {
    dataset: "test",
    name: "Test source",
    license: "CC-BY-4.0",
    upstreamVersion: "1.0.0",
    url: "https://example.invalid/test.geojson",
    file: "test.geojson",
    sha256: BODY_SHA,
    ...overrides,
  };
}

describe("fetchSource", () => {
  let dir: string;
  let calls: string[];
  let fetcher: Fetcher;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fetch-"));
    calls = [];
    fetcher = async (url) => {
      calls.push(url);
      return BODY;
    };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("downloads, verifies and writes the raw file", async () => {
    const result = await fetchSource(specOf(), dir, { writePins: false, refresh: false, fetcher });
    expect(result.sha256).toBe(BODY_SHA);
    expect(result.cached).toBe(false);
    expect(readFileSync(join(dir, "test.geojson"))).toEqual(BODY);
  });

  it("fails hard when the checksum does not match, and writes nothing", async () => {
    const spec = specOf({ sha256: "0".repeat(64) });
    await expect(
      fetchSource(spec, dir, { writePins: false, refresh: false, fetcher }),
    ).rejects.toThrow(/checksum mismatch/i);
    expect(() => readFileSync(join(dir, "test.geojson"))).toThrow();
  });

  it("refuses to run against an unpinned source", async () => {
    const spec = specOf({ sha256: null });
    await expect(
      fetchSource(spec, dir, { writePins: false, refresh: false, fetcher }),
    ).rejects.toThrow(/unpinned/i);
  });

  it("allows an unpinned source only when writing pins", async () => {
    const spec = specOf({ sha256: null });
    const result = await fetchSource(spec, dir, { writePins: true, refresh: false, fetcher });
    expect(result.sha256).toBe(BODY_SHA);
  });

  it("skips the download when a verified copy is already present", async () => {
    writeFileSync(join(dir, "test.geojson"), BODY);
    const result = await fetchSource(specOf(), dir, { writePins: false, refresh: false, fetcher });
    expect(result.cached).toBe(true);
    expect(calls).toEqual([]);
  });

  it("re-downloads when refresh is set", async () => {
    writeFileSync(join(dir, "test.geojson"), BODY);
    await fetchSource(specOf(), dir, { writePins: false, refresh: true, fetcher });
    expect(calls).toHaveLength(1);
  });

  it("extracts the named entry from a zip and pins the zip itself", async () => {
    const zip = new AdmZip();
    zip.addFile("cliopatria.geojson", BODY);
    const zipped = zip.toBuffer();
    const spec = specOf({
      file: "cliopatria.geojson.zip",
      unpack: "cliopatria.geojson",
      sha256: sha256Of(zipped),
    });
    const zipFetcher: Fetcher = async () => zipped;
    const result = await fetchSource(spec, dir, {
      writePins: false,
      refresh: false,
      fetcher: zipFetcher,
    });
    expect(result.sha256).toBe(sha256Of(zipped));
    expect(readFileSync(join(dir, "cliopatria.geojson"))).toEqual(BODY);
  });

  it("re-extracts the unpacked entry even when one is already present, so a corrupt unpacked file cannot survive", async () => {
    const zip = new AdmZip();
    zip.addFile("cliopatria.geojson", BODY);
    const zipped = zip.toBuffer();
    const spec = specOf({
      file: "cliopatria.geojson.zip",
      unpack: "cliopatria.geojson",
      sha256: sha256Of(zipped),
    });
    writeFileSync(join(dir, "cliopatria.geojson.zip"), zipped);
    writeFileSync(join(dir, "cliopatria.geojson"), Buffer.from("CORRUPT"));
    const result = await fetchSource(spec, dir, {
      writePins: false,
      refresh: false,
      fetcher: async () => zipped,
    });
    expect(result.cached).toBe(true);
    expect(readFileSync(join(dir, "cliopatria.geojson"))).toEqual(BODY);
  });

  it("re-verifies a cached raw download and refuses when it no longer matches its pin", async () => {
    writeFileSync(join(dir, "test.geojson"), Buffer.from("TAMPERED"));
    await expect(
      fetchSource(specOf(), dir, { writePins: false, refresh: false, fetcher }),
    ).rejects.toThrow(/checksum mismatch/i);
    expect(calls).toEqual([]);
  });
});
