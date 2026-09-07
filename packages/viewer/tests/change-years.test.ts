import type { VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";
import { describe, expect, it } from "vitest";
import { ChangeYears, eventYearsFrom } from "../src/engine/change-years";

const rows = readArtifact<VersionsArtifact>("fixtures/dist/versions.0.json").rows;

describe("eventYearsFrom", () => {
  // Acceptance criterion 15. The oracle is built here, independently of the
  // implementation: a fade-in begins at fromYear, a fade-out at toYear + 1.
  it("is exactly the union of fromYear and toYear + 1, sorted and unique", () => {
    const expected = [...new Set(rows.flatMap((r) => [r.fromYear, r.toYear + 1]))].sort(
      (a, b) => a - b,
    );
    expect(eventYearsFrom(rows)).toEqual(expected);
  });
});

describe("ChangeYears", () => {
  const changes = new ChangeYears(rows);

  it("returns the smallest event year strictly greater than the query", () => {
    for (const y of changes.years) {
      const next = changes.nextChangeAfter(y);
      if (next === null) continue;
      expect(next).toBeGreaterThan(y);
      const between = changes.years.filter((c) => c > y && c < next);
      expect(between).toHaveLength(0);
    }
  });

  it("handles fractional years", () => {
    const first = changes.years[0] as number;
    const second = changes.years[1] as number;
    expect(changes.nextChangeAfter(first + 0.5)).toBe(second);
    expect(changes.nextChangeAfter(first - 0.5)).toBe(first);
  });

  it("returns null past the last event", () => {
    const last = changes.years[changes.years.length - 1] as number;
    expect(changes.nextChangeAfter(last)).toBeNull();
    expect(changes.nextChangeAfter(last + 1000)).toBeNull();
  });
});
