/**
 * Artifact-contract id construction. Lives in the model because the viewer
 * reads these ids out of artifacts and must not reach into the pipeline.
 */

/**
 * The polity id. Cliopatria keys entities on Name -- its README defines entity
 * lookup as finding the row "containing the Name of the entity where the year
 * of interest is between FromYear and ToYear". Wikidata is per-row metadata and
 * is unusable as a key: it is reused across distinct polities and varies within
 * a single entity. See decision 0011. The raw name is used rather than a
 * normalised slug because normalisation is not injective over this dataset --
 * it merges "X" with "(X)", which the source treats as different territories.
 */
export function polityIdFor(name: string): string {
  return `name:${name}`;
}

/**
 * Unique because "no polity has two versions with the same from_year" is an
 * acceptance criterion, enforced in the lineage stage.
 */
export function versionIdFor(polityId: string, fromYear: number): string {
  return `${polityId}@${fromYear}`;
}
