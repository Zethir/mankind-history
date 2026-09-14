import type { VersionsArtifact } from "@history/model";
import { describe, expect, it } from "vitest";
import { bestAvailable, LevelRegistry } from "../src/data/levels";
import type { DetailLevel } from "../src/render/level";

const artifact = (level: string): VersionsArtifact =>
  ({
    schemaVersion: 2,
    level,
    coordScale: 1,
    rows: [],
    geometry: {},
  }) as unknown as VersionsArtifact;

function registry() {
  const requested: string[] = [];
  const resolvers = new Map<string, (v: VersionsArtifact) => void>();
  const rejecters = new Map<string, (e: Error) => void>();
  const r = new LevelRegistry((level: DetailLevel) => {
    requested.push(level);
    return new Promise<VersionsArtifact>((resolve, reject) => {
      resolvers.set(level, resolve);
      rejecters.set(level, reject);
    });
  });
  return {
    r,
    requested,
    settle: (l: string) => resolvers.get(l)?.(artifact(l)),
    fail: (l: string) => rejecters.get(l)?.(new Error("network")),
  };
}

describe("prefetch policy", () => {
  // Acceptance criterion 6 (amended: the prefetch chain is unconditional now
  // that level switching by zoom was dropped -- see progress.md Task 7
  // ruling). Coarse is resident from startup because main.ts already loads
  // it before the registry exists.
  it("requests mid after first paint, and not before", () => {
    const { r, requested } = registry();
    expect(requested).toEqual([]);
    r.onFirstPaint();
    expect(requested).toEqual(["mid"]);
  });

  // onFirstZoom no longer exists: full follows mid unconditionally once mid
  // arrives, rather than waiting on a zoom gate that only made sense when
  // levels switched by zoom.
  it("requests full once mid becomes resident, without any zoom", async () => {
    const { r, requested, settle } = registry();
    r.onFirstPaint();
    expect(requested).not.toContain("full");
    settle("mid");
    await Promise.resolve();
    await Promise.resolve();
    expect(requested).toContain("full");
  });

  // Full has no dependency on mid's *data*, only on being requested after
  // it (so the two fetches do not compete for bandwidth). Catches a
  // regression where `request("full")` is called only from mid's success
  // branch: a transient network error on mid would then permanently cap
  // that session at coarse, since nothing else in the class ever requests
  // full.
  it("requests full even when mid's fetch fails", async () => {
    const { r, requested, fail } = registry();
    r.onFirstPaint();
    fail("mid");
    await Promise.resolve();
    await Promise.resolve();
    expect(r.stateOf("mid")).toBe("failed");
    expect(requested).toContain("full");
  });

  // Acceptance criterion 7.
  it("never re-requests a level already resident or in flight", async () => {
    const { r, requested, settle } = registry();
    r.onFirstPaint();
    r.request("mid");
    r.request("mid");
    settle("mid");
    await Promise.resolve();
    r.request("mid");
    expect(requested.filter((l) => l === "mid")).toHaveLength(1);
  });

  it("does not retry a failed level on every subsequent request", async () => {
    const requested: string[] = [];
    const r = new LevelRegistry((level) => {
      requested.push(level);
      return Promise.reject(new Error("network"));
    });
    r.request("full");
    await Promise.resolve();
    await Promise.resolve();
    r.request("full");
    r.request("full");
    expect(requested.filter((l) => l === "full")).toHaveLength(1);
    expect(r.stateOf("full")).toBe("failed");
  });
});

describe("bestAvailable", () => {
  // No `wanted` argument: bestAvailable(registry) is always the finest
  // resident level -- there is no ceiling to fall back under, because
  // detail only ever improves and there is no downgrade.
  //
  // Pins the seeding invariant directly (stateOf, not bestAvailable's
  // fallthrough): bestAvailable falls through to "coarse" whenever nothing
  // at all is resident, so an assertion on bestAvailable alone would still
  // pass if the constructor never seeded coarse as resident. Verified by
  // mutation: deleting `coarse.state = "resident"` in levels.ts's
  // constructor turns this assertion red (see task-7-report.md).
  it("seeds coarse as resident from construction, before any request", () => {
    const { r } = registry();
    expect(r.stateOf("coarse")).toBe("resident");
    expect(bestAvailable(r)).toBe("coarse");
  });

  it("reports the finest level that has become resident", async () => {
    const { r, settle } = registry();
    r.request("mid");
    settle("mid");
    await Promise.resolve();
    expect(bestAvailable(r)).toBe("mid");
  });

  // The whole meaning of "progressive": once full is resident, bestAvailable
  // can never again report something coarser, no matter what is requested
  // afterwards.
  it("never regresses once full is resident", async () => {
    const { r, settle } = registry();
    r.request("mid");
    settle("mid");
    await Promise.resolve();
    r.request("full");
    settle("full");
    await Promise.resolve();
    expect(bestAvailable(r)).toBe("full");
    // Re-request full itself, not mid: a no-op since full is resident, but
    // it exercises the entry `bestAvailable` actually reads, rather than an
    // unrelated one.
    r.request("full");
    expect(bestAvailable(r)).toBe("full");
  });
});
