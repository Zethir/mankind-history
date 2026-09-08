import type { LandArtifact, PolitiesArtifact, VersionsArtifact } from "@history/model";
import { SCHEMA_VERSION } from "@history/model";

/**
 * The three artifacts M1 needs. `changes.json` is deliberately absent: its
 * cells mix fromYear and toYear values indistinguishably, so the event years
 * playback needs cannot be recovered from it. See src/engine/change-years.ts.
 */
export interface Artifacts {
  polities: PolitiesArtifact;
  versions: VersionsArtifact;
  land: LandArtifact;
}

export function assertSchema(file: string, schemaVersion: number): void {
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `${file}: unsupported schemaVersion ${schemaVersion}, expected ${SCHEMA_VERSION}`,
    );
  }
}

export function validateArtifacts(a: Artifacts): Artifacts {
  assertSchema("polities.json", a.polities.schemaVersion);
  assertSchema("versions.0.json", a.versions.schemaVersion);
  assertSchema("land.0.json", a.land.schemaVersion);
  return a;
}

/**
 * `base` is relative by default so the app works when served from a subpath
 * such as https://<user>.github.io/mankind-history/. A leading slash would
 * resolve against the domain root and 404 there.
 */
export async function fetchArtifacts(base = "."): Promise<Artifacts> {
  const get = async <T>(name: string): Promise<T> => {
    const res = await fetch(`${base}/${name}`);
    if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };
  const [polities, versions, land] = await Promise.all([
    get<PolitiesArtifact>("polities.json"),
    get<VersionsArtifact>("versions.0.json"),
    get<LandArtifact>("land.0.json"),
  ]);
  return validateArtifacts({ polities, versions, land });
}
