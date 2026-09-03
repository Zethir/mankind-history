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
    upstreamVersion: "UNPINNED",
    url: "UNPINNED",
    file: "cliopatria.geojson.zip",
    unpack: "cliopatria.geojson",
    sha256: null,
  },
  naturalEarth110mLand: {
    dataset: "naturalEarth110mLand",
    name: "Natural Earth \u2014 land (110m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_110m_land.geojson",
    file: "ne_110m_land.geojson",
    sha256: null,
  },
  naturalEarth50mLand: {
    dataset: "naturalEarth50mLand",
    name: "Natural Earth \u2014 land (50m)",
    license: "public-domain",
    upstreamVersion: "5.1.1",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.1/geojson/ne_50m_land.geojson",
    file: "ne_50m_land.geojson",
    sha256: null,
  },
};

/** The file the pipeline actually reads: the unpacked entry when there is one. */
export function sourcePath(spec: SourceSpec, dir: string): string {
  return `${dir}/${spec.unpack ?? spec.file}`;
}
