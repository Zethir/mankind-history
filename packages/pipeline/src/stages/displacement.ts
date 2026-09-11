import { join } from "node:path";
import { COORD_SCALE, type VersionsArtifact } from "@history/model";
import { readArtifact } from "@history/model/artifact";

/**
 * Per-arc border displacement between the full-detail geometry and a
 * simplified level, measured directly on shared arcs -- never on polygons.
 *
 * Extracted from packages/pipeline/tests/acceptance.test.ts (the
 * "no pair of previously-adjacent polygons has gained a gap wider than one
 * screen pixel" test), which explains at length why this is the only
 * formulation of six that worked: every full-detail edge is keyed
 * direction-independently by the set of version ids using it, edges with two
 * or more users are grouped by their exact co-user set and chained into
 * maximal polylines ("shared arcs"), and each side's simplified border along
 * an arc is the retained subsequence of that arc's own points -- valid only
 * because mapshaper drops vertices and never relocates them. A side retaining
 * fewer than two points has dropped the arc, which is a removal and is
 * counted separately, not measured as displacement.
 */

interface Arc {
  users: number[];
  path: number[];
}

/** Distance from a point to a line segment, not to its endpoints. */
function pointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** One-sided Hausdorff: the furthest any point of `a` sits from the polyline `b`. */
function directedHausdorff(a: number[], b: number[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 2) {
    let nearest = Number.POSITIVE_INFINITY;
    for (let j = 0; j + 3 < b.length; j += 2) {
      const d = pointToSegment(
        a[i] as number,
        a[i + 1] as number,
        b[j] as number,
        b[j + 1] as number,
        b[j + 2] as number,
        b[j + 3] as number,
      );
      if (d < nearest) nearest = d;
    }
    if (nearest > worst) worst = nearest;
  }
  return worst;
}

function hausdorff(a: number[], b: number[]): number {
  return Math.max(directedHausdorff(a, b), directedHausdorff(b, a));
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Builds the shared arcs from full-detail geometry: every edge keyed
 * direction-independently with its set of users, edges with two or more
 * users grouped by their exact co-user set, and each group chained into
 * maximal polylines.
 */
function buildArcs(full: VersionsArtifact): {
  arcs: Arc[];
  posX: number[];
  posY: number[];
  versionIds: string[];
  versionIndex: Map<string, number>;
} {
  const positionIds = new Map<string, number>();
  const posX: number[] = [];
  const posY: number[] = [];
  const internPosition = (x: number, y: number): number => {
    const key = `${x},${y}`;
    const existing = positionIds.get(key);
    if (existing !== undefined) return existing;
    const id = posX.length;
    positionIds.set(key, id);
    posX.push(x);
    posY.push(y);
    return id;
  };

  const versionIds = Object.keys(full.geometry);
  const versionIndex = new Map(versionIds.map((id, i) => [id, i] as const));

  const edgeUsers = new Map<string, Set<number>>();
  for (const [id, g] of Object.entries(full.geometry)) {
    const user = versionIndex.get(id) as number;
    for (const polygon of g.polygons) {
      for (const ring of polygon) {
        let previous = internPosition(ring[0] as number, ring[1] as number);
        for (let i = 2; i < ring.length; i += 2) {
          const current = internPosition(ring[i] as number, ring[i + 1] as number);
          if (current !== previous) {
            const key = edgeKey(previous, current);
            const users = edgeUsers.get(key);
            if (users) users.add(user);
            else edgeUsers.set(key, new Set([user]));
          }
          previous = current;
        }
      }
    }
  }

  // Grouped by the EXACT co-user set, so two borders that merely touch at a
  // node are never chained into one arc.
  const groupedEdges = new Map<string, Array<[number, number]>>();
  for (const [key, users] of edgeUsers) {
    if (users.size < 2) continue;
    const groupKey = [...users].sort((a, b) => a - b).join(",");
    const parts = key.split(":");
    const edge: [number, number] = [Number(parts[0]), Number(parts[1])];
    const edges = groupedEdges.get(groupKey);
    if (edges) edges.push(edge);
    else groupedEdges.set(groupKey, [edge]);
  }

  const arcs: Arc[] = [];
  for (const [groupKey, edges] of groupedEdges) {
    const users = groupKey.split(",").map(Number);
    const adjacency = new Map<number, number[]>();
    const link = (a: number, b: number) => {
      const list = adjacency.get(a);
      if (list) list.push(b);
      else adjacency.set(a, [b]);
    };
    for (const [a, b] of edges) {
      link(a, b);
      link(b, a);
    }
    const walked = new Set<string>();
    const walkFrom = (start: number) => {
      for (const first of adjacency.get(start) as number[]) {
        if (walked.has(edgeKey(start, first))) continue;
        const path = [start];
        let previous = start;
        let current = first;
        for (;;) {
          walked.add(edgeKey(previous, current));
          path.push(current);
          const neighbours = adjacency.get(current) as number[];
          // A junction or a dead end ends the arc: beyond it the co-users
          // are no longer the same two sides walking together.
          if (neighbours.length !== 2) break;
          const next = (neighbours[0] === previous ? neighbours[1] : neighbours[0]) as number;
          if (walked.has(edgeKey(current, next))) break;
          previous = current;
          current = next;
        }
        arcs.push({ users, path });
      }
    };
    for (const [node, neighbours] of adjacency) if (neighbours.length !== 2) walkFrom(node);
    for (const node of adjacency.keys()) walkFrom(node); // closed loops have no endpoint
  }

  return { arcs, posX, posY, versionIds, versionIndex };
}

/** Detail levels this measurement can compare against the full-detail geometry. */
export type Level = "coarse" | "mid";

const LEVEL_FILE: Record<Level, string> = {
  coarse: "versions.0.json",
  mid: "versions.1.json",
};

export interface DisplacementReport {
  arcsConsidered: number;
  identical: number;
  droppedArcs: number;
  /**
   * Ascending, in projected units. One entry per displaced arc (worst
   * Hausdorff distance among its sides).
   */
  displacements: number[];
}

/**
 * Measures per-arc border displacement between `full` (versions.2.json in
 * `fullDir`) and the given simplified level, from artifacts in `fullDir`.
 *
 * Returns displacements in projected units (world space), not pixels: pixel
 * conversion depends on a viewport scale the caller chooses, not on anything
 * this measurement knows.
 */
export function measureDisplacement(fullDir: string, level: Level): DisplacementReport {
  const full = readArtifact<VersionsArtifact>(join(fullDir, "versions.2.json"));
  const { arcs, posX, posY, versionIndex } = buildArcs(full);

  const simplified = readArtifact<VersionsArtifact>(join(fullDir, LEVEL_FILE[level]));
  const scale = COORD_SCALE[level];
  const rescale = (v: number) => Math.round((v / COORD_SCALE.full) * scale);

  // Which versions retain each position, in this level's coordinates.
  const retainedBy = new Map<string, Set<number>>();
  for (const [id, g] of Object.entries(simplified.geometry)) {
    const user = versionIndex.get(id) as number;
    for (const polygon of g.polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i += 2) {
          const key = `${ring[i]},${ring[i + 1]}`;
          const users = retainedBy.get(key);
          if (users) users.add(user);
          else retainedBy.set(key, new Set([user]));
        }
      }
    }
  }

  // The load-bearing assumption: mapshaper drops vertices, never moves them.
  // If it ever moved one, "retained subsequence" would stop being a faithful
  // description of the simplified border and every number below would be
  // measuring the wrong thing. Enforced here, not just asserted by a caller,
  // because it is required for every use of this function, CLI included.
  const fullPositions = new Set<string>();
  for (let i = 0; i < posX.length; i++) {
    fullPositions.add(`${rescale(posX[i] as number)},${rescale(posY[i] as number)}`);
  }
  let relocated = 0;
  for (const key of retainedBy.keys()) if (!fullPositions.has(key)) relocated++;
  if (relocated > 0) {
    throw new Error(
      `${relocated} position(s) in ${level} are not present in the full-detail geometry -- ` +
        "mapshaper relocated a vertex instead of only dropping vertices, which invalidates " +
        "this measurement's core assumption.",
    );
  }

  let arcsConsidered = 0;
  let identical = 0;
  let droppedArcs = 0;
  const displacements: number[] = [];

  for (const arc of arcs) {
    if (arc.path.length < 3) continue;
    arcsConsidered++;

    const points = arc.path.map(
      (p) => [rescale(posX[p] as number), rescale(posY[p] as number)] as const,
    );
    const holders = points.map(([x, y]) => retainedBy.get(`${x},${y}`));

    // Each side's simplified border along this arc: the arc's own points, in
    // arc order, that this version still has.
    const sides = new Map<number, number[]>();
    let sideDropped = false;
    for (const user of arc.users) {
      const retained: number[] = [];
      for (let i = 0; i < points.length; i++) {
        if (holders[i]?.has(user)) {
          const point = points[i] as readonly [number, number];
          retained.push(point[0], point[1]);
        }
      }
      if (retained.length < 4) sideDropped = true;
      sides.set(user, retained);
    }
    if (sideDropped) {
      droppedArcs++;
      continue;
    }

    let worstHere = 0;
    for (let i = 0; i < arc.users.length; i++) {
      for (let j = i + 1; j < arc.users.length; j++) {
        const d = hausdorff(
          sides.get(arc.users[i] as number) as number[],
          sides.get(arc.users[j] as number) as number[],
        );
        if (d > worstHere) worstHere = d;
      }
    }
    if (worstHere > 0) {
      displacements.push(worstHere / scale);
    } else {
      identical++;
    }
  }

  displacements.sort((a, b) => a - b);

  return { arcsConsidered, identical, droppedArcs, displacements };
}
