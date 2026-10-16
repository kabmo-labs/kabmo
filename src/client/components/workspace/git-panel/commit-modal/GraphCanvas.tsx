import { useMemo } from 'preact/hooks';
import type { GitCommit } from '@/shared/types/git';
import { LANE_COLORS, buildBezierPath, computeCommitLanes, computeGraphLinks } from '@/shared/lib/fs/git-graph';

interface GraphCanvasProps {
  commits: GitCommit[];
  nodePositions: Record<string, number>;
  selectedHash?: string;
  hoveredHash?: string;
  isGraphMode: boolean;
  laneWidth?: number;
  paddingLeft?: number;
  totalHeight: number;
}

export function GraphCanvas({
  commits,
  nodePositions,
  selectedHash,
  hoveredHash,
  isGraphMode,
  laneWidth = 18,
  paddingLeft = 16,
  totalHeight,
}: GraphCanvasProps) {
  const laneMap = useMemo(() => {
    if (!isGraphMode) {
      // In history mode, all commits are in a single lane
      const m = new Map<string, number>();
      commits.forEach((c) => m.set(c.hash, 0));
      return m;
    }
    return computeCommitLanes(commits);
  }, [commits, isGraphMode]);

  const maxLane = useMemo(() => {
    let max = 0;
    laneMap.forEach((lane) => {
      if (lane > max) max = lane;
    });
    return max;
  }, [laneMap]);

  const canvasWidth = isGraphMode ? (maxLane + 1) * laneWidth + paddingLeft * 2 : 36;

  const links = useMemo(() => {
    if (!isGraphMode) {
      // In history mode, a single continuous vertical line connects all commits sequentially!
      const histLinks = [];
      for (let i = 0; i < commits.length - 1; i++) {
        const fromY = nodePositions[commits[i].hash] ?? (i * 60 + 20);
        const toY = nodePositions[commits[i + 1].hash] ?? ((i + 1) * 60 + 20);
        histLinks.push({
          fromHash: commits[i].hash,
          toHash: commits[i + 1].hash,
          fromLane: 0,
          toLane: 0,
          fromY,
          toY,
          color: 'var(--theme-ink)',
        });
      }
      return histLinks;
    }

    return computeGraphLinks(
      commits,
      laneMap,
      nodePositions,
      totalHeight
    );
  }, [commits, laneMap, nodePositions, totalHeight, isGraphMode]);

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none z-10"
      style={{ width: canvasWidth, height: totalHeight }}
    >
      <svg
        className="w-full h-full overflow-visible"
        style={{ width: canvasWidth, height: totalHeight }}
      >
        <defs>
          <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2" floodOpacity="0.35" />
          </filter>
        </defs>

        {/* 1. Continuous Connecting Lines */}
        {links.map((link) => {
          const x1 = isGraphMode ? paddingLeft + link.fromLane * laneWidth : 16;
          const x2 = isGraphMode ? paddingLeft + link.toLane * laneWidth : 16;
          const stroke = isGraphMode ? link.color : 'currentColor';
          const strokeOpacity = isGraphMode ? 0.95 : 0.25;

          const pathD = buildBezierPath(x1, link.fromY, x2, link.toY);

          return (
            <path
              key={`${link.fromHash}->${link.toHash}`}
              d={pathD}
              fill="none"
              stroke={stroke}
              strokeWidth={isGraphMode ? 2.25 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={strokeOpacity}
            />
          );
        })}

        {/* 2. Commit Node Circles */}
        {commits.map((commit) => {
          const lane = laneMap.get(commit.hash) ?? 0;
          const cx = isGraphMode ? paddingLeft + lane * laneWidth : 16;
          const cy = nodePositions[commit.hash] ?? 20;
          const isSelected = selectedHash === commit.hash || selectedHash === commit.shortHash;
          const isHovered = hoveredHash === commit.hash || hoveredHash === commit.shortHash;
          const laneColor = isGraphMode
            ? LANE_COLORS[lane % LANE_COLORS.length]
            : 'var(--theme-success)'; // Theme success variable in History mode

          return (
            <g key={`node-${commit.hash}`} data-commit-node={commit.hash}>
              {/* Outer halo when active or hovered */}
              {(isSelected || isHovered) && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={8}
                  fill={laneColor}
                  fillOpacity={isSelected ? 0.35 : 0.2}
                  stroke={laneColor}
                  strokeWidth={1}
                />
              )}

              {/* Solid commit node. `data-commit-dot` is what a spec measures
                  against its row's own title: the halo is a different radius,
                  and reading "the circle at cy" off `r` would be layout detail. */}
              <circle
                data-commit-dot=""
                cx={cx}
                cy={cy}
                r={isGraphMode ? 4 : 4.5}
                fill={isGraphMode ? 'var(--theme-paper)' : laneColor}
                stroke={laneColor}
                strokeWidth={isGraphMode ? 2.5 : 1.5}
                filter="url(#node-glow)"
              />

              {/* Inner dot for Graph Mode */}
              {isGraphMode && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={1.8}
                  fill={laneColor}
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
