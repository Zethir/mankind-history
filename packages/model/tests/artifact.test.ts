import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readArtifact, stableStringify, writeArtifact } from "../src/artifact";

describe("stableStringify", () => {
  it("orders object keys identically regardless of insertion order", () => {
    const a = { beta: 1, alpha: 2, gamma: 3 };
    const b = { gamma: 3, alpha: 2, beta: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"alpha":2,"beta":1,"gamma":3}');
  });

  it("orders keys by code point, not by locale", () => {
    expect(stableStringify({ Z: 1, a: 2 })).toBe('{"Z":1,"a":2}');
  });

  it("preserves array order, which carries meaning in geometry", () => {
    expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("sorts nested objects too", () => {
    expect(stableStringify({ outer: { b: 1, a: 2 } })).toBe('{"outer":{"a":2,"b":1}}');
  });

  it("drops undefined properties rather than emitting invalid JSON", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("throws on non-finite numbers instead of silently writing null", () => {
    expect(() => stableStringify({ x: Number.NaN })).toThrow(/non-finite/);
    expect(() => stableStringify({ x: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });
});

describe("writeArtifact", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "artifact-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes a trailing newline and no BOM", () => {
    const path = join(dir, "a.json");
    writeArtifact(path, { b: 1, a: 2 });
    const raw = readFileSync(path, "utf8");
    expect(raw).toBe('{"a":2,"b":1}\n');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("produces byte-identical files for equivalent values", () => {
    const one = join(dir, "one.json");
    const two = join(dir, "two.json");
    writeArtifact(one, { z: [1, 2], a: { n: 3 } });
    writeArtifact(two, { a: { n: 3 }, z: [1, 2] });
    expect(readFileSync(one)).toEqual(readFileSync(two));
  });

  it("round-trips through readArtifact", () => {
    const path = join(dir, "r.json");
    const value = { rows: [{ id: "x", n: 1 }], schemaVersion: 1 };
    writeArtifact(path, value);
    expect(readArtifact<typeof value>(path)).toEqual(value);
  });
});
