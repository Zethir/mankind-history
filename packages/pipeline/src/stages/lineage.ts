import type { Version } from "@history/model";
import { versionIdFor } from "@history/model";
import type { NormalisedRow } from "./normalise";

/** An entry in packages/pipeline/overlaps.json. Every one needs a reason. */
export interface OverlapWhitelistEntry {
  earlier: string;
  later: string;
  reason: string;
}

export interface LineageResult {
  versions: Version[];
  overlaps: Array<{ earlier: string; later: string }>;
  /** version id -> index into the input rows, so geometry can follow the version. */
  rowIndexById: Record<string, number>;
}

/**
 * Group by polity, sort by year, link each version to its predecessor.
 *
 * `prevId`, `delta` and `gap` exist only here - Cliopatria stores versions
 * independently. Decision 0004's expansion flash reads all three, and `gap` is
 * what keeps it honest: a version arriving after a long hole represents
 * accumulated drift rather than a datable event.
 */
export function deriveLineage(
  rows: NormalisedRow[],
  rowPolityIds: string[],
  whitelist: OverlapWhitelistEntry[],
  sourceVersion: string,
  /**
   * Positionally aligned with `rows`, from `resolveMembership` (decision
   * 0017). Required, not defaulted: a defaulted-to-empty array let a caller
   * that forgot to wire membership through produce `memberOf: null` on every
   * version with a build that still passed -- a silent loss of decision
   * 0017's data, not a loud failure. Every call site must say explicitly what
   * membership it means, `[]` included.
   */
  rowMemberOfIds: Array<string | null>,
): LineageResult {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const polityId = rowPolityIds[i] as string;
    const bucket = groups.get(polityId);
    if (bucket) bucket.push(i);
    else groups.set(polityId, [i]);
  }

  const duplicates: string[] = [];
  const overlaps: Array<{ earlier: string; later: string }> = [];
  const versions: Version[] = [];
  const rowIndexById: Record<string, number> = {};

  for (const [polityId, indices] of groups) {
    indices.sort((a, b) => {
      const ra = rows[a] as NormalisedRow;
      const rb = rows[b] as NormalisedRow;
      return ra.fromYear - rb.fromYear || ra.toYear - rb.toYear || a - b;
    });

    let prev: Version | null = null;
    for (const index of indices) {
      const source = rows[index] as NormalisedRow;

      if (prev !== null && prev.fromYear === source.fromYear) {
        duplicates.push(`${polityId} has two versions starting in ${source.fromYear}`);
        continue;
      }

      const id = versionIdFor(polityId, source.fromYear);
      const version: Version = {
        id,
        polityId,
        memberOf: rowMemberOfIds[index] ?? null,
        fromYear: source.fromYear,
        toYear: source.toYear,
        area: source.area,
        prevId: prev === null ? null : prev.id,
        delta: prev === null ? null : source.area - prev.area,
        gap: prev === null ? null : Math.max(0, source.fromYear - prev.toYear),
        confidence: null,
        source: { dataset: "cliopatria", version: sourceVersion },
      };

      if (prev !== null && source.fromYear <= prev.toYear) {
        overlaps.push({ earlier: prev.id, later: id });
      }

      versions.push(version);
      rowIndexById[id] = index;
      prev = version;
    }
  }

  // Fail the build, do not warn. A warning in a pipeline nobody watches is the
  // same as no check at all - docs/standards.md.
  if (duplicates.length > 0) {
    const affected = new Set(duplicates.map((d) => d.split(" has ")[0])).size;
    throw new Error(
      `${duplicates.length} duplicate from_year rows across ${affected} polities, which breaks the ` +
        `version id. Fix the data or add an alias.\n  ${duplicates.slice(0, 20).join("\n  ")}`,
    );
  }

  const allowed = new Set(whitelist.map((w) => `${w.earlier}|${w.later}`));
  const unlisted = overlaps.filter((o) => !allowed.has(`${o.earlier}|${o.later}`));
  if (unlisted.length > 0) {
    const sample = unlisted
      .slice(0, 20)
      .map((o) => `${o.earlier} overlaps ${o.later}`)
      .join("\n  ");
    throw new Error(
      `${unlisted.length} of ${overlaps.length} version overlaps are not whitelisted. Add each to ` +
        `packages/pipeline/overlaps.json with a reason, or fix the data.\n  ${sample}`,
    );
  }

  versions.sort(
    (a, b) =>
      (a.polityId < b.polityId ? -1 : a.polityId > b.polityId ? 1 : 0) ||
      a.fromYear - b.fromYear ||
      a.toYear - b.toYear,
  );

  return { versions, overlaps, rowIndexById };
}
