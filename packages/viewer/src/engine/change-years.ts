import type { ChangesArtifact } from "@history/model";
import { cellRangeFor } from "@history/model";

/** The smallest entry in a sorted, deduplicated array strictly greater than `year`. */
function smallestGreaterThan(sorted: readonly number[], year: number): number | null {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) > year) hi = mid;
    else lo = mid + 1;
  }
  return lo < sorted.length ? (sorted[lo] as number) : null;
}

/**
 * Backs decision 0006's "when does this view next change", scoped to a
 * viewport once one exists (Milestone 2) and to the whole world when it does
 * not (a null bbox).
 *
 * Reads years out of `changes.json` rather than deriving them from version
 * rows: the index is a spatial structure, keyed by grid cell, so it is the
 * only structure that can answer "next change *in this bbox*" without
 * scanning every version's geometry per query.
 *
 * The index buckets each polygon's own bounding box, not the polity's or the
 * version's -- see docs/decisions/0013-index-buckets-polygons.md. A bounding
 * box is still not the polygon itself, so a query can report a change just
 * outside the visible shape. That is an accepted trade, not a bug: the
 * failure mode is a brief pause for something slightly off-screen, which
 * shows more than necessary rather than silently skipping something real.
 * Do not "fix" this by shrinking the box to the polygon; that would require
 * indexing at polygon resolution, which decision 0013 rejected on cost.
 */
export class ChangeYears {
  private readonly changes: ChangesArtifact;
  /** The union of every cell's years, cached because a null bbox (zoomed out) is the common case. */
  private readonly world: readonly number[];

  constructor(changes: ChangesArtifact) {
    this.changes = changes;
    const years = new Set<number>();
    for (const cell of changes.cells) {
      for (const year of cell) years.add(year);
    }
    this.world = [...years].sort((a, b) => a - b);
  }

  /**
   * The smallest event year strictly greater than `year` within `bbox`, or
   * null past the last event. `bbox` is in unscaled projected units, computed
   * by `render/` and handed down as plain numbers; a null bbox means the
   * whole world.
   */
  nextChangeAfter(year: number, bbox: [number, number, number, number] | null): number | null {
    if (bbox === null) return smallestGreaterThan(this.world, year);

    const { grid, cells } = this.changes;
    const { x0, x1, y0, y1 } = cellRangeFor(grid, bbox);
    let best: number | null = null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = cells[y * grid.cols + x];
        if (!cell) continue;
        const candidate = smallestGreaterThan(cell, year);
        if (candidate !== null && (best === null || candidate < best)) best = candidate;
      }
    }
    return best;
  }
}
