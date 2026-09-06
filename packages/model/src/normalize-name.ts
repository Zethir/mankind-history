/**
 * A stored field for the deferred name-drift report (decision 0007). It is
 * not an identity key: decision 0011 keys `Polity.id` on the raw upstream
 * `Name` instead, and this value is not even unique on its own -- 34
 * normalised names collide across the full polity set. It is pinned by tests
 * anyway, because a silent change here would silently change what that future
 * drift report compares.
 *
 * NFKD first so combining marks separate from their base letters, then the
 * combining-mark range is stripped, then everything outside [a-z0-9] collapses
 * to a single hyphen.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
