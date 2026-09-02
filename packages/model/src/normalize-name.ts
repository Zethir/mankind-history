/**
 * The fallback polity identity key (decision 0007). Changing this rule re-keys
 * every polity without a Wikidata id and resets its lineage chain, so it is
 * pinned by tests.
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
