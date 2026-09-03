import { readFileSync, writeFileSync } from "node:fs";

/**
 * JSON with deterministic key ordering. Byte-identical output is an acceptance
 * criterion, and JSON.stringify preserves insertion order, which differs
 * between construction paths that produce equivalent values.
 *
 * Keys sort by code point via plain comparison, never localeCompare, which is
 * locale-dependent and would make output vary by machine.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`non-finite number in artifact: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",");
  return `{${body}}`;
}

/** The only way artifacts are written. LF endings, trailing newline, no BOM. */
export function writeArtifact(path: string, value: unknown): void {
  writeFileSync(path, `${stableStringify(value)}\n`, "utf8");
}

export function readArtifact<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
