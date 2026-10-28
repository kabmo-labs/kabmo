/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the commit-graph geometry.
 *
 * Lane assignment is the one piece of the history view that cannot be eyeballed
 * from a screenshot: a wrong lane silently overlaps two unrelated branches, and
 * a wrong link draws a line to a commit that is not a parent. The cases below
 * pin the three rules the renderer depends on — parent-driven lane tracking,
 * the >=4-char short-hash prefix rule (git abbreviates parents, rows carry full
 * hashes), and the tail link that keeps a truncated history from ending in
 * mid-air. Geometry cases pin the exact SVG strings so a change to the control
 * points is visible as a diff rather than as a subtly different curve.
 */

import { describe, expect, test } from 'bun:test';

import type { GitCommit } from '@/shared/types/git';
import {
  buildBezierPath,
  computeCommitLanes,
  computeGraphLinks,
  LANE_COLORS,
} from '@/shared/lib/fs/git-graph';

/** Minimal commit row: only hash / shortHash / parents / lane reach the algorithm. */
function c(hash: string, parents: string[] = [], extra: Partial<GitCommit> = {}): GitCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: 'A',
    date: '',
    message: '',
    parents,
    ...extra,
  };
}

describe('computeCommitLanes', () => {
  test('an empty history produces no lanes', () => {
    expect(computeCommitLanes([]).size).toBe(0);
  });

  test('a linear history keeps every commit on lane 0', () => {
    const lanes = computeCommitLanes([c('c1', ['c2']), c('c2', ['c3']), c('c3')]);
    expect([lanes.get('c1'), lanes.get('c2'), lanes.get('c3')]).toEqual([0, 0, 0]);
  });

  test('a merge opens a second lane for the branch parent', () => {
    // m is a merge of a and b; a stays on the merge's lane, b takes lane 1,
    // and the shared base returns to lane 0.
    const lanes = computeCommitLanes([c('m', ['a', 'b']), c('a', ['base']), c('b', ['base']), c('base')]);
    expect([lanes.get('m'), lanes.get('a'), lanes.get('b'), lanes.get('base')]).toEqual([0, 0, 1, 0]);
  });

  test('a merge parent already tracked by another lane is not duplicated', () => {
    // p is already active from x; the merge must not claim a new slot for it.
    const lanes = computeCommitLanes([c('x', ['p']), c('m', ['x', 'p']), c('p')]);
    expect([lanes.get('x'), lanes.get('m'), lanes.get('p')]).toEqual([0, 1, 0]);
  });

  test('a freed lane is reused by the next unrelated root', () => {
    // c1 has no parents, so slot 0 becomes free and c2 reuses it instead of
    // growing the graph to a needless second column.
    const lanes = computeCommitLanes([c('c1'), c('c2')]);
    expect([lanes.get('c1'), lanes.get('c2')]).toEqual([0, 0]);
  });

  test('a 7-char parent hash matches the full 40-char commit hash', () => {
    const lanes = computeCommitLanes([c('aaaaaaaabbbb', ['fffffff1']), c('fffffff1cccc')]);
    expect(lanes.get('fffffff1cccc')).toBe(0);
  });

  test('a 4-char prefix matches, a 3-char prefix does not', () => {
    const four = computeCommitLanes([c('c1', ['abcd']), c('abcdef')]);
    expect(four.get('abcdef')).toBe(0);

    // Below the 4-char floor a prefix is ambiguous, so the parent is treated
    // as unrelated and the commit gets its own lane.
    const three = computeCommitLanes([c('c1', ['abc']), c('abcdef')]);
    expect(three.get('abcdef')).toBe(1);
  });

  test('identical hashes match even below the 4-char prefix floor', () => {
    const lanes = computeCommitLanes([c('ab', ['cd']), c('cd')]);
    expect(lanes.get('cd')).toBe(0);
  });

  test('a row carrying an explicit lane keeps it and leaves tracking untouched', () => {
    // Explicit lanes are authoritative; they must not seed activeLanes, so the
    // child below cannot inherit lane 3 and starts at the first free slot.
    const lanes = computeCommitLanes([c('c1', ['c2'], { lane: 3 }), c('c2')]);
    expect(lanes.get('c1')).toBe(3);
    expect(lanes.get('c2')).toBe(0);
  });

  test('a commit is matched through its shortHash when the stored parent is the full hash', () => {
    const lanes = computeCommitLanes([
      c('aaaaaaaaaa', ['bbbbbbbbbb']),
      c('zzzz', [], { shortHash: 'bbbbbbbbbb' }),
    ]);
    expect(lanes.get('zzzz')).toBe(0);
  });
});

describe('computeGraphLinks', () => {
  test('a linear parent produces one link carrying both endpoints', () => {
    const commits = [c('c', ['p']), c('p')];
    const links = computeGraphLinks(
      commits,
      computeCommitLanes(commits),
      { c: 0, p: 60 },
      120
    );
    expect(links).toEqual([
      {
        fromHash: 'c',
        toHash: 'p',
        fromLane: 0,
        toLane: 0,
        fromY: 0,
        toY: 60,
        color: LANE_COLORS[0],
      },
    ]);
  });

  test('a merge emits one link per parent, in parent order', () => {
    const commits = [c('m', ['a', 'b']), c('a'), c('b')];
    const links = computeGraphLinks(commits, computeCommitLanes(commits), { m: 0, a: 60, b: 60 }, 180);
    expect(links.map(l => [l.toHash, l.fromLane, l.toLane, l.toY])).toEqual([
      ['a', 0, 0, 60],
      ['b', 0, 1, 60],
    ]);
  });

  test('a root commit draws no link at all', () => {
    const commits = [c('root')];
    expect(computeGraphLinks(commits, computeCommitLanes(commits), { root: 0 }, 100)).toEqual([]);
  });

  test('a parent beyond the loaded page becomes a tail link to the bottom', () => {
    const links = computeGraphLinks([c('c', ['deadbeefdeadbeef'])], new Map([['c', 0]]), { c: 100 }, 500);
    expect(links).toEqual([
      {
        fromHash: 'c',
        toHash: 'tail-c',
        fromLane: 0,
        toLane: 0,
        fromY: 100,
        toY: 500,
        color: LANE_COLORS[0],
      },
    ]);
  });

  test('a tail link still extends 80px when the total height is smaller', () => {
    const links = computeGraphLinks([c('c', ['deadbeefdeadbeef'])], new Map([['c', 0]]), { c: 100 }, 0);
    expect(links[0].toY).toBe(180);
  });

  test('missing positions fall back to 0 and the +60px row pitch', () => {
    const links = computeGraphLinks([c('c', ['p']), c('p')], new Map([['c', 0], ['p', 0]]), {}, 120);
    expect([links[0].fromY, links[0].toY]).toEqual([0, 60]);
  });

  test('a missing lane falls back to lane 0 for both ends', () => {
    const links = computeGraphLinks([c('c', ['p']), c('p')], new Map(), {}, 120);
    expect([links[0].fromLane, links[0].toLane, links[0].color]).toEqual([0, 0, LANE_COLORS[0]]);
  });

  test('lane colors wrap around the palette', () => {
    const commits = [c('c', ['p']), c('p')];
    const links = computeGraphLinks(commits, new Map([['c', 8], ['p', 8]]), { c: 0, p: 60 }, 120);
    expect(LANE_COLORS).toHaveLength(8);
    expect(links[0].color).toBe(LANE_COLORS[0]);
  });

  test('a parent given by 7-char prefix resolves to the full commit row', () => {
    const commits = [c('c', ['1234567']), c('1234567890abcdef')];
    const links = computeGraphLinks(commits, computeCommitLanes(commits), { c: 0, '1234567890abcdef': 60 }, 120);
    expect(links).toHaveLength(1);
    expect(links[0].toHash).toBe('1234567890abcdef');
  });

  test('a longer parent hash resolves through its 7-char prefix', () => {
    // The parent string is 10 chars and is not indexed verbatim; the renderer
    // must fall back to the 7-char prefix so the edge is not lost.
    const commits = [c('c', ['1234567abc']), c('1234567XYZ')];
    const links = computeGraphLinks(commits, computeCommitLanes(commits), { c: 0, '1234567XYZ': 60 }, 120);
    expect(links).toHaveLength(1);
    expect(links[0].toHash).toBe('1234567XYZ');
  });
});

describe('buildBezierPath', () => {
  test('a sub-pixel lane change stays a straight line', () => {
    expect(buildBezierPath(10, 0, 10.5, 100)).toBe('M 10 0 L 10.5 100');
  });

  test('an exactly one-pixel lane change is drawn as a curve', () => {
    expect(buildBezierPath(10, 0, 11, 100)).toBe('M 10 0 C 10 45, 11 55, 11 100');
  });

  test('the control points mirror a downward run', () => {
    expect(buildBezierPath(10, 100, 30, 0)).toBe('M 10 100 C 10 55, 30 45, 30 0');
  });
});
