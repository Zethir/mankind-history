import type { Version } from "@history/model";

/**
 * The years at which something visibly changes: a version's fade-in begins at
 * its fromYear, and its fade-out begins at toYear + 1.
 *
 * Derived from the version rows, not from changes.json. The index cannot
 * answer this: its cells store fromYear and toYear values mixed together and
 * indistinguishable, so toYear + 1 is unrecoverable from them. The index
 * exists for viewport scoping, which Milestone 1 does not do -- with no zoom,
 * the whole world is the viewport. See docs/phase-2-milestone-1-design.md for
 * the pipeline fix Milestone 2 needs before it can use the index here.
 */
export function eventYearsFrom(rows: readonly Version[]): number[] {
  const years = new Set<number>();
  for (const r of rows) {
    years.add(r.fromYear);
    years.add(r.toYear + 1);
  }
  return [...years].sort((a, b) => a - b);
}

/** Backs decision 0006's "when does this view next change". */
export class ChangeYears {
  readonly years: readonly number[];

  constructor(rows: readonly Version[]) {
    this.years = eventYearsFrom(rows);
  }

  /** The smallest event year strictly greater than `year`, or null past the end. */
  nextChangeAfter(year: number): number | null {
    let lo = 0;
    let hi = this.years.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.years[mid] as number) > year) hi = mid;
      else lo = mid + 1;
    }
    return lo < this.years.length ? (this.years[lo] as number) : null;
  }
}
