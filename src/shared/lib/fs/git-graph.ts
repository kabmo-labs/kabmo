import type { GitCommit } from '@kabmo-labs/kabmo-app-contracts/git';

export const LANE_COLORS = [
  '#38bdf8', // sky/blue
  '#f97316', // orange
  '#a855f7', // purple
  '#10b981', // emerald
  '#ec4899', // pink
  '#eab308', // amber
  '#06b6d4', // cyan
  '#6366f1', // indigo
];

export interface GraphLink {
  fromHash: string;
  toHash: string;
  fromLane: number;
  toLane: number;
  fromY: number;
  toY: number;
  color: string;
}

export interface ComputedCommitNode {
  commit: GitCommit;
  lane: number;
  x: number;
  y: number;
  color: string;
}

/** Helper to match full hashes and short hashes (e.g. 7-char parent with 40-char commit hash) */
function isSameHash(h1: string | null | undefined, h2: string | null | undefined): boolean {
  if (!h1 || !h2) return false;
  if (h1 === h2) return true;
  const minLen = Math.min(h1.length, h2.length);
  if (minLen >= 4) {
    return h1.substring(0, minLen) === h2.substring(0, minLen);
  }
  return false;
}

/** Assign lanes to commits based on parent-child topology */
export function computeCommitLanes(commits: GitCommit[]): Map<string, number> {
  const laneMap = new Map<string, number>();
  const activeLanes: (string | null)[] = [];

  for (const commit of commits) {
    // If commit already has an explicit lane from data, respect it
    if (typeof commit.lane === 'number') {
      laneMap.set(commit.hash, commit.lane);
      continue;
    }

    // Check if an active lane points to this commit (matching full or short hash)
    let lane = activeLanes.findIndex(
      (target) => isSameHash(target, commit.hash) || isSameHash(target, commit.shortHash)
    );

    if (lane === -1) {
      // Find the first free slot
      lane = activeLanes.indexOf(null);
      if (lane === -1) {
        lane = activeLanes.length;
        activeLanes.push(commit.hash);
      } else {
        activeLanes[lane] = commit.hash;
      }
    }

    laneMap.set(commit.hash, lane);

    // Update active lanes with parents
    const firstParent = commit.parents && commit.parents[0];
    if (firstParent) {
      activeLanes[lane] = firstParent;
    } else {
      activeLanes[lane] = null;
    }

    // Additional parents (merge branches) get other slots
    if (commit.parents && commit.parents.length > 1) {
      for (let i = 1; i < commit.parents.length; i++) {
        const parent = commit.parents[i];
        const alreadyTracked = activeLanes.some((target) => isSameHash(target, parent));
        if (!alreadyTracked) {
          const freeSlot = activeLanes.indexOf(null);
          if (freeSlot === -1) {
            activeLanes.push(parent);
          } else {
            activeLanes[freeSlot] = parent;
          }
        }
      }
    }
  }

  return laneMap;
}

/** Generate continuous links connecting nodes */
export function computeGraphLinks(
  commits: GitCommit[],
  laneMap: Map<string, number>,
  positions: Record<string, number>,
  totalHeight: number
): GraphLink[] {
  const links: GraphLink[] = [];
  const hashToIndex = new Map<string, number>();

  commits.forEach((c, idx) => {
    hashToIndex.set(c.hash, idx);
    if (c.shortHash) {
      hashToIndex.set(c.shortHash, idx);
    }
    if (c.hash.length >= 7) {
      hashToIndex.set(c.hash.substring(0, 7), idx);
    }
  });

  for (const commit of commits) {
    const fromLane = laneMap.get(commit.hash) ?? 0;
    const fromY = positions[commit.hash] ?? 0;
    const color = LANE_COLORS[fromLane % LANE_COLORS.length];

    if (!commit.parents || commit.parents.length === 0) {
      continue;
    }

    for (const parentHash of commit.parents) {
      let parentIdx = hashToIndex.get(parentHash);
      if (typeof parentIdx !== 'number' && parentHash.length >= 7) {
        parentIdx = hashToIndex.get(parentHash.substring(0, 7));
      }

      if (typeof parentIdx === 'number') {
        const parentCommit = commits[parentIdx];
        const toLane = laneMap.get(parentCommit.hash) ?? fromLane;
        const toY = positions[parentCommit.hash] ?? (fromY + 60);

        links.push({
          fromHash: commit.hash,
          toHash: parentCommit.hash,
          fromLane,
          toLane,
          fromY,
          toY,
          color: LANE_COLORS[fromLane % LANE_COLORS.length],
        });
      } else {
        // Parent is beyond the loaded commits: draw continuation line to bottom
        links.push({
          fromHash: commit.hash,
          toHash: 'tail-' + commit.hash,
          fromLane,
          toLane: fromLane,
          fromY,
          toY: Math.max(fromY + 80, totalHeight),
          color,
        });
      }
    }
  }

  return links;
}

/** Build smooth cubic bezier path string between two lane coordinates */
export function buildBezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  if (Math.abs(x1 - x2) < 1) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const dy = y2 - y1;
  const cp1Y = y1 + dy * 0.45;
  const cp2Y = y2 - dy * 0.45;

  return `M ${x1} ${y1} C ${x1} ${cp1Y}, ${x2} ${cp2Y}, ${x2} ${y2}`;
}
