/** Which detail artifact to draw at a given zoom. */
export type DetailLevel = "coarse" | "mid" | "full";

/**
 * The pipeline emits `land.0` (coarse) and `land.1` (mid) only -- there is no
 * `land.2` -- so the land layer saturates at mid regardless of how detailed
 * the political layer gets.
 */
export function landLevelFor(level: DetailLevel): "coarse" | "mid" {
  return level === "coarse" ? "coarse" : "mid";
}
