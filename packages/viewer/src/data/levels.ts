import type { VersionsArtifact } from "@history/model";
import type { DetailLevel } from "../render/level";

export type LoadState = "absent" | "loading" | "resident" | "failed";

const LEVELS: readonly DetailLevel[] = ["coarse", "mid", "full"];

interface Entry {
  state: LoadState;
  artifact: VersionsArtifact | null;
}

/**
 * Tracks how much of each detail level has loaded and drives the
 * progressive-upgrade prefetch chain: coarse is resident from construction
 * (main.ts already loaded it before this exists), mid is requested after
 * first paint, and full is requested once mid becomes resident. There is no
 * downgrade and no "wanted" level -- detail only ever improves, so
 * `bestAvailable` is just the finest resident level.
 *
 * The fetcher is injected so this policy is unit-testable under
 * `environment: "node"` without a real `fetch` or DOM.
 */
export class LevelRegistry {
  private readonly entries = new Map<DetailLevel, Entry>();
  private readonly fetcher: (level: DetailLevel) => Promise<VersionsArtifact>;

  constructor(fetcher: (level: DetailLevel) => Promise<VersionsArtifact>) {
    this.fetcher = fetcher;
    for (const level of LEVELS) {
      this.entries.set(level, { state: "absent", artifact: null });
    }
    // Seeded, not requested: coarse is already loaded by main.ts before the
    // registry is constructed, so it must never be fetched again here.
    const coarse = this.entries.get("coarse") as Entry;
    coarse.state = "resident";
  }

  stateOf(level: DetailLevel): LoadState {
    return (this.entries.get(level) as Entry).state;
  }

  artifactOf(level: DetailLevel): VersionsArtifact | null {
    return (this.entries.get(level) as Entry).artifact;
  }

  /**
   * A no-op for any level not `absent`. This is what makes "never re-request
   * a resident or in-flight level" and "never retry a failed level" both
   * true by construction: the only way back to `absent` is never, so once an
   * entry leaves that state it is untouched for the registry's lifetime.
   */
  request(level: DetailLevel): void {
    const entry = this.entries.get(level) as Entry;
    if (entry.state !== "absent") return;
    entry.state = "loading";
    this.fetcher(level).then(
      (artifact) => {
        entry.state = "resident";
        entry.artifact = artifact;
        if (level === "mid") this.request("full");
      },
      () => {
        entry.state = "failed";
      },
    );
  }

  onFirstPaint(): void {
    this.request("mid");
  }
}

/**
 * The finest resident level, full stop. There is no ceiling to fall back
 * under -- detail only ever improves, so this can never regress: state
 * transitions only move an entry forward (absent -> loading -> resident or
 * failed), never back, so once a finer level is resident it stays resident.
 */
export function bestAvailable(registry: LevelRegistry): DetailLevel {
  for (let i = LEVELS.length - 1; i >= 0; i -= 1) {
    const level = LEVELS[i] as DetailLevel;
    if (registry.stateOf(level) === "resident") return level;
  }
  return "coarse";
}
