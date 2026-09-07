/** Whether playback adapts to the data or honours a speed the user set. */
export type PlaybackMode = "auto" | "manual";

/** One version to draw this frame. */
export interface Draw {
  versionId: string;
  /** Opacity, in (0, 1]. */
  alpha: number;
  /** Expansion-flash brightness, in [0, 1]. Zero for most versions. */
  flash: number;
}

/**
 * The entire engine-to-renderer contract. Plain data, so the engine's
 * behaviour can be snapshot-tested without a canvas.
 */
export interface Frame {
  year: number;
  speed: number;
  mode: PlaybackMode;
  draws: Draw[];
}
