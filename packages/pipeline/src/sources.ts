export interface SourceSpec {
  dataset: string;
  /** Human-readable name, copied into the manifest. */
  name: string;
  /** SPDX-style identifier, copied into the manifest. */
  license: string;
  upstreamVersion: string;
  url: string;
  /** Filename for the raw download. `sha256` pins exactly this file. */
  file: string;
  /** null means unpinned: fetch refuses to run without --write-pins. */
  sha256: string | null;
  /** Zip entry to extract. Also the filename the pipeline reads. */
  unpack?: string | undefined;
}

/**
 * The pinned inputs. Bumping any of these is a deliberate act: edit the pin,
 * re-fetch, re-run the build, re-run the acceptance checks and re-bless the
 * fixtures. See docs/data-sources.md.
 */
export const SOURCES: Record<string, SourceSpec> = {
  cliopatria: {
    dataset: "cliopatria",
    name: "Cliopatria (Seshat Global History Databank)",
    license: "CC-BY-4.0",
    upstreamVersion: "v0.2.0",
    // v0.2.0 is a lightweight tag, which can be moved. It currently points at
    // commit ad28a691b7c07c1fca89d0e0636d324667d2a258 -- recorded here so the
    // exact bytes stay recoverable even if the tag is ever repointed.
    url: "https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/v0.2.0/cliopatria.geojson.zip",
    file: "cliopatria.geojson.zip",
    unpack: "cliopatria_polities_only.geojson",
    sha256: "d01ae3a20d358cc5d54f69d9d725d390767d9c8759ac89ad6f90c58d106f3370",
  },
  naturalEarth110mLand: {
    dataset: "naturalEarth110mLand",
    name: "Natural Earth \u2014 land (110m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_110m_land.geojson",
    file: "ne_110m_land.geojson",
    sha256: "9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9",
  },
  naturalEarth50mLand: {
    dataset: "naturalEarth50mLand",
    name: "Natural Earth \u2014 land (50m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_50m_land.geojson",
    file: "ne_50m_land.geojson",
    sha256: "e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b",
  },
};

/** The file the pipeline actually reads: the unpacked entry when there is one. */
export function sourcePath(spec: SourceSpec, dir: string): string {
  return `${dir}/${spec.unpack ?? spec.file}`;
}
